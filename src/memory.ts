/**
 * Pure memory logic: no Cloudflare APIs, no I/O, so it is unit-testable.
 *
 * Memory model per conversation:
 *   - `messages`: the most recent turns, kept verbatim.
 *   - `summary`:  a rolling LLM-written summary of older turns that were
 *                 compacted out of `messages` once the history grew too long.
 *   - `services`: structured facts the user has shared about their services,
 *                 extracted by the LLM and upserted by name.
 */
import type { ChatMessage, ConversationState, ServiceFact } from "./types";

/** Compact once more than this many verbatim messages are stored. */
export const MAX_VERBATIM_MESSAGES = 12;
/** How many recent messages to keep verbatim after compaction. */
export const KEEP_AFTER_COMPACTION = 6;

export function shouldCompact(
  messages: ChatMessage[],
  max = MAX_VERBATIM_MESSAGES,
): boolean {
  return messages.length > max;
}

/**
 * Split history into the part to fold into the summary and the part to keep.
 * The kept tail always starts on a user message so the model never sees an
 * assistant reply without the question that prompted it.
 */
export function splitForCompaction(
  messages: ChatMessage[],
  keep = KEEP_AFTER_COMPACTION,
): { toSummarize: ChatMessage[]; toKeep: ChatMessage[] } {
  if (messages.length <= keep) return { toSummarize: [], toKeep: messages };
  let cut = messages.length - keep;
  while (cut < messages.length && messages[cut].role !== "user") cut++;
  return { toSummarize: messages.slice(0, cut), toKeep: messages.slice(cut) };
}

export function buildSummaryPrompt(
  existingSummary: string,
  toSummarize: ChatMessage[],
): ChatMessage[] {
  const transcript = toSummarize
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "You maintain a running summary of a conversation between an on-call engineer " +
        "and a reliability assistant. Write a compact summary (max 150 words) that keeps: " +
        "the incident(s) discussed, decisions made, checks already performed and their " +
        "results, and open questions. Plain prose, no preamble.",
    },
    {
      role: "user",
      content:
        (existingSummary ? `Previous summary:\n${existingSummary}\n\n` : "") +
        `New messages to fold in:\n${transcript}`,
    },
  ];
}

export function buildExtractionPrompt(userMessage: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Extract facts about the user's own software services from their message. " +
        'Respond with JSON only: {"services":[{"name":"...","notes":"..."}]}. ' +
        "A service is a specific named system the user says they run, own or operate, " +
        "such as payments-api, ledger-db or notification-worker. Generic technologies " +
        "(Postgres, Kafka, Redis, a database, a queue) are NOT services; mention them " +
        "inside notes instead. `notes` holds durable facts in one sentence: language, tier, " +
        "owner, dependencies, SLOs, known failure modes. Skip transient incident details. " +
        'If no named service is mentioned, respond {"services":[]}.',
    },
    { role: "user", content: userMessage },
  ];
}

/**
 * Parse the extraction model's output defensively. LLMs sometimes wrap JSON in
 * code fences or prose; we find the first `{...}` block and validate shape.
 */
export function parseServiceFacts(raw: string): { name: string; notes: string }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { services?: unknown })?.services;
  if (!Array.isArray(list)) return [];
  const out: { name: string; notes: string }[] = [];
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const notes = typeof item?.notes === "string" ? item.notes.trim() : "";
    if (name && name.length <= 80) out.push({ name, notes });
  }
  return out;
}

/** Case-insensitive upsert by name. Newer notes are appended, not overwritten, deduplicated. */
export function upsertService(
  services: ServiceFact[],
  fact: { name: string; notes: string },
  now: number,
): ServiceFact[] {
  const key = fact.name.toLowerCase();
  const existing = services.find((s) => s.name.toLowerCase() === key);
  if (!existing) {
    return [...services, { name: fact.name, notes: fact.notes, updatedAt: now }];
  }
  const merged =
    fact.notes && !existing.notes.toLowerCase().includes(fact.notes.toLowerCase())
      ? [existing.notes, fact.notes].filter(Boolean).join(" ")
      : existing.notes;
  return services.map((s) =>
    s === existing ? { ...s, notes: merged, updatedAt: now } : s,
  );
}

/** Assemble the message array sent to the chat model for a new turn. */
export function buildChatContext(
  state: ConversationState,
  systemPrompt: string,
): ChatMessage[] {
  const parts = [systemPrompt];
  if (state.services.length > 0) {
    parts.push(
      "Known services (from memory):\n" +
        state.services.map((s) => `- ${s.name}: ${s.notes || "no notes yet"}`).join("\n"),
    );
  }
  if (state.summary) {
    parts.push(`Summary of earlier conversation:\n${state.summary}`);
  }
  return [{ role: "system", content: parts.join("\n\n") }, ...state.messages];
}
