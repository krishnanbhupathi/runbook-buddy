/**
 * Pure logic for runbook generation: prompt construction, defensive parsing of
 * model output, and assembly. No Cloudflare APIs, so it is unit-testable and
 * the Workflow class stays thin.
 */
import type { ChatMessage } from "./types";

export const MAX_SECTIONS = 6;

export const DEFAULT_SECTIONS = [
  "Service overview and dependencies",
  "Health signals and dashboards to check first",
  "Common failure modes and how to confirm each",
  "Mitigation steps",
  "Escalation and communication",
];

export interface RunbookInput {
  service: string;
  /** Durable facts about the service from memory (may be empty). */
  notes: string;
  /** Rolling conversation summary, for incident context (may be empty). */
  summary: string;
}

export function buildOutlinePrompt(input: RunbookInput): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You design on-call runbooks. Given a service description, propose the section " +
        `titles for its incident runbook. Respond with JSON only: {"sections":["..."]}. ` +
        `Between 3 and ${MAX_SECTIONS} sections, ordered from first check to escalation. ` +
        "Titles only, no numbering, no prose.",
    },
    { role: "user", content: describeService(input) },
  ];
}

/** Accepts messy model output; falls back to DEFAULT_SECTIONS if unusable. */
export function parseOutline(raw: string): string[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return DEFAULT_SECTIONS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return DEFAULT_SECTIONS;
  }
  const list = (parsed as { sections?: unknown })?.sections;
  if (!Array.isArray(list)) return DEFAULT_SECTIONS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const title = item.replace(/^\s*\d+[.)]\s*/, "").trim();
    const key = title.toLowerCase();
    if (!title || title.length > 100 || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length === MAX_SECTIONS) break;
  }
  return out.length >= 3 ? out : DEFAULT_SECTIONS;
}

export function buildSectionPrompt(
  input: RunbookInput,
  sectionTitle: string,
  allSections: string[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You write one section of an on-call runbook in Markdown. Be concrete and " +
        "actionable: numbered steps, exact things to check, expected healthy values where " +
        "sensible. Do not invent tool names or URLs the user did not mention; say " +
        '"your dashboard" or "your logs" instead. 80 to 200 words. Do not repeat the ' +
        "section title as a heading; start directly with content.",
    },
    {
      role: "user",
      content:
        `${describeService(input)}\n\n` +
        `Full runbook outline: ${allSections.join(" | ")}\n\n` +
        `Write ONLY the section titled: "${sectionTitle}".`,
    },
  ];
}

export function assembleRunbook(
  service: string,
  sections: { title: string; body: string }[],
  generatedAt: Date,
): string {
  const header = `# Runbook: ${service}\n\n_Generated ${generatedAt.toISOString().slice(0, 10)} by Runbook Buddy. Review before relying on it._\n`;
  const body = sections
    .map((s, i) => `\n## ${i + 1}. ${s.title}\n\n${s.body.trim()}\n`)
    .join("");
  return header + body;
}

function describeService(input: RunbookInput): string {
  const lines = [`Service: ${input.service}`];
  lines.push(`Known facts: ${input.notes || "none recorded"}`);
  if (input.summary) lines.push(`Recent conversation context: ${input.summary}`);
  return lines.join("\n");
}

/** Find a service in memory by name, case-insensitively, tolerating light typos in spacing/case. */
export function findService<T extends { name: string }>(services: T[], name: string): T | undefined {
  const key = name.trim().toLowerCase();
  return services.find((s) => s.name.toLowerCase() === key);
}

/** Parse the chat command `/runbook <service>`; returns null if the message is not a command. */
export function parseRunbookCommand(message: string): string | null {
  const m = message.trim().match(/^\/runbook\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
