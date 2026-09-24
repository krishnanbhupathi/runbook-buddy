/**
 * Thin wrapper around Workers AI so the rest of the code never touches model
 * IDs or response shapes directly. Llama 3.3 70B (fp8, fast) as recommended by
 * the assignment.
 */
import type { ChatMessage } from "./types";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
}

/** Non-streaming completion. Returns the assistant text. */
export async function complete(
  ai: Ai,
  messages: ChatMessage[],
  opts: LlmOptions = {},
): Promise<string> {
  const result = (await ai.run(MODEL, {
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
  })) as unknown;
  return extractText(result);
}

/**
 * Workers AI's non-streaming output shape differs between models and API
 * revisions: older ones return `{ response: string }`, newer OpenAI-compatible
 * ones return `{ choices: [{ message: { content } }] }`, and some wrap the
 * former as `{ response: { ... } }`. Handle all three.
 */
export function extractText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const r = result as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };
  if (typeof r.response === "string") return r.response.trim();
  const fromChoices = r.choices?.[0]?.message?.content;
  if (typeof fromChoices === "string") return fromChoices.trim();
  if (r.response && typeof r.response === "object") return extractText(r.response);
  console.error("Unrecognised Workers AI response shape:", JSON.stringify(result).slice(0, 300));
  return "";
}

/**
 * Streaming completion. Workers AI returns a ReadableStream of Server-Sent
 * Events (`data: {"response":"..."}` lines). We pass it straight through to the
 * browser, which parses the same format.
 */
export async function stream(
  ai: Ai,
  messages: ChatMessage[],
  opts: LlmOptions = {},
): Promise<ReadableStream> {
  return (await ai.run(MODEL, {
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
  })) as ReadableStream;
}
