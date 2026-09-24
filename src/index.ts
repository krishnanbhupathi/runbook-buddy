/**
 * Worker entrypoint. Routes:
 *   POST /api/chat   { conversationId, message }  -> SSE stream of the reply
 *   GET  /api/health                              -> { ok: true }
 * Anything else falls through to static assets (the chat UI in ./public).
 */
import type { ChatMessage, Env } from "./types";
import { stream } from "./llm";

export { ConversationDO } from "./conversation-do";
export { RunbookWorkflow } from "./runbook-workflow";

const SYSTEM_PROMPT =
  "You are Runbook Buddy, a concise reliability engineering assistant. " +
  "You help on-call engineers work through incidents step by step. " +
  "Ask one clarifying question at a time when you need more information.";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as
        | { message?: string }
        | null;
      const message = body?.message?.trim();
      if (!message) return json({ error: "message is required" }, 400);

      // Milestone 1: stateless. Memory (Durable Object) arrives in milestone 2.
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ];
      const sse = await stream(env.AI, messages);
      return new Response(sse, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
