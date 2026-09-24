/**
 * Worker entrypoint. Routes:
 *   POST   /api/chat    { conversationId, message } -> SSE stream of the reply
 *   GET    /api/memory  ?conversationId=...         -> conversation state
 *   DELETE /api/memory  ?conversationId=...         -> wipe that conversation
 *   POST   /api/runbook { conversationId, service } -> start a Workflow run
 *   GET    /api/runbook/:id                          -> Workflow instance status
 *   GET    /api/health                              -> { ok: true }
 * Anything else falls through to static assets (the chat UI in ./public).
 */
import type { Env } from "./types";
import { stream } from "./llm";
import { teeSse } from "./sse";
import { SYSTEM_PROMPT } from "./prompts";
import { findService, parseRunbookCommand } from "./runbook";

export { ConversationDO } from "./conversation-do";
export { RunbookWorkflow } from "./runbook-workflow";

const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function conversationStub(env: Env, id: string) {
  // getByName derives a stable Durable Object ID from the string, so the same
  // conversationId always lands on the same instance (and its storage).
  return env.CONVERSATION.getByName(id);
}

/** Start the runbook Workflow for a service known to this conversation. */
async function startRunbook(env: Env, conversationId: string, serviceName: string): Promise<Response> {
  const convo = conversationStub(env, conversationId);
  const state = await convo.getState();
  const service = findService(state.services, serviceName);
  if (!service) {
    return json(
      { error: `Unknown service "${serviceName}". Tell me about it in chat first.`, known: state.services.map((s) => s.name) },
      404,
    );
  }
  const instance = await env.RUNBOOK_WORKFLOW.create({
    params: { conversationId, service: service.name, notes: service.notes, summary: state.summary },
  });
  await convo.upsertRunbook({
    workflowId: instance.id,
    service: service.name,
    content: "",
    status: "running",
    createdAt: Date.now(),
  });
  return json({ workflowId: instance.id, service: service.name }, 202);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") return json({ ok: true });

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as
        | { conversationId?: string; message?: string }
        | null;
      const message = body?.message?.trim();
      const conversationId = body?.conversationId;
      if (!message) return json({ error: "message is required" }, 400);
      if (!conversationId || !ID_PATTERN.test(conversationId)) {
        return json({ error: "conversationId must match [a-zA-Z0-9_-]{8,64}" }, 400);
      }
      if (message.length > 4000) return json({ error: "message too long" }, 413);

      // Chat-triggered action: "/runbook <service>" starts the Workflow instead of chatting.
      const cmd = parseRunbookCommand(message);
      if (cmd) return startRunbook(env, conversationId, cmd);

      const convo = conversationStub(env, conversationId);
      await convo.appendMessage("user", message);
      const context = await convo.buildContext(SYSTEM_PROMPT);

      const { stream: sse, text } = teeSse(await stream(env.AI, context));

      // After the reply finishes streaming: persist it, then extract service
      // facts and compact history. waitUntil keeps the Worker alive past the
      // response without making the user wait.
      ctx.waitUntil(
        text.then(async (reply) => {
          if (reply) await convo.appendMessage("assistant", reply);
          await convo.maintain(message);
        }),
      );

      return new Response(sse, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    if (url.pathname === "/api/memory") {
      const conversationId = url.searchParams.get("conversationId") ?? "";
      if (!ID_PATTERN.test(conversationId)) return json({ error: "bad conversationId" }, 400);
      const convo = conversationStub(env, conversationId);
      if (request.method === "GET") {
        const [state, runbooks] = await Promise.all([convo.getState(), convo.getRunbooks()]);
        return json({ ...state, runbooks });
      }
      if (request.method === "DELETE") {
        await convo.clear();
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/runbook" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as
        | { conversationId?: string; service?: string }
        | null;
      const conversationId = body?.conversationId ?? "";
      const service = body?.service?.trim() ?? "";
      if (!ID_PATTERN.test(conversationId) || !service) {
        return json({ error: "conversationId and service are required" }, 400);
      }
      return startRunbook(env, conversationId, service);
    }

    const runbookMatch = url.pathname.match(/^\/api\/runbook\/([A-Za-z0-9-]+)$/);
    if (runbookMatch && request.method === "GET") {
      try {
        const instance = await env.RUNBOOK_WORKFLOW.get(runbookMatch[1]);
        const status = await instance.status();
        return json({ id: runbookMatch[1], status: status.status, error: status.error ?? null, output: status.output ?? null });
      } catch {
        return json({ error: "workflow instance not found" }, 404);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
