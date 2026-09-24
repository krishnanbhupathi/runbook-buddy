/**
 * Worker entrypoint. Routes:
 *   POST   /api/chat    { conversationId, message } -> SSE stream of the reply
 *   GET    /api/memory  ?conversationId=...         -> conversation state
 *   DELETE /api/memory  ?conversationId=...         -> wipe that conversation
 *   GET    /api/health                              -> { ok: true }
 * Anything else falls through to static assets (the chat UI in ./public).
 */
import type { Env } from "./types";
import { stream } from "./llm";
import { teeSse } from "./sse";
import { SYSTEM_PROMPT } from "./prompts";

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

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
