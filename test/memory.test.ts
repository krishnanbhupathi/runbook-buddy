import { describe, expect, it } from "vitest";
import {
  buildChatContext,
  buildSummaryPrompt,
  KEEP_AFTER_COMPACTION,
  MAX_VERBATIM_MESSAGES,
  parseServiceFacts,
  shouldCompact,
  splitForCompaction,
  upsertService,
} from "../src/memory";
import type { ChatMessage, ServiceFact } from "../src/types";

const turn = (i: number): ChatMessage[] => [
  { role: "user", content: `u${i}` },
  { role: "assistant", content: `a${i}` },
];
const history = (turns: number) => Array.from({ length: turns }, (_, i) => turn(i)).flat();

describe("compaction", () => {
  it("triggers only above the verbatim limit", () => {
    expect(shouldCompact(history(MAX_VERBATIM_MESSAGES / 2))).toBe(false);
    expect(shouldCompact(history(MAX_VERBATIM_MESSAGES / 2 + 1))).toBe(true);
  });

  it("keeps the tail and starts it on a user message", () => {
    const msgs = history(7); // 14 messages
    const { toSummarize, toKeep } = splitForCompaction(msgs);
    expect(toKeep.length).toBe(KEEP_AFTER_COMPACTION);
    expect(toKeep[0].role).toBe("user");
    expect(toSummarize.length + toKeep.length).toBe(msgs.length);
    expect([...toSummarize, ...toKeep]).toEqual(msgs);
  });

  it("advances the cut to the next user message when it would land on an assistant turn", () => {
    // 13 messages: cut at 13-6=7 lands on an assistant message (odd index).
    const msgs = [...history(6), { role: "user", content: "u6" } as ChatMessage];
    const { toKeep } = splitForCompaction(msgs);
    expect(toKeep[0].role).toBe("user");
    expect(toKeep.length).toBeLessThanOrEqual(KEEP_AFTER_COMPACTION);
  });

  it("does nothing for short histories", () => {
    const msgs = history(2);
    expect(splitForCompaction(msgs)).toEqual({ toSummarize: [], toKeep: msgs });
  });

  it("summary prompt carries the previous summary and the transcript", () => {
    const prompt = buildSummaryPrompt("earlier stuff", turn(1));
    expect(prompt[1].content).toContain("Previous summary:\nearlier stuff");
    expect(prompt[1].content).toContain("USER: u1");
    expect(prompt[1].content).toContain("ASSISTANT: a1");
  });
});

describe("parseServiceFacts", () => {
  it("parses clean JSON", () => {
    expect(parseServiceFacts('{"services":[{"name":"api","notes":"tier 1"}]}')).toEqual([
      { name: "api", notes: "tier 1" },
    ]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw = 'Sure! ```json\n{"services":[{"name":"db","notes":"pg"}]}\n``` done';
    expect(parseServiceFacts(raw)).toEqual([{ name: "db", notes: "pg" }]);
  });

  it("returns empty for garbage, wrong shapes and malformed entries", () => {
    expect(parseServiceFacts("no json here")).toEqual([]);
    expect(parseServiceFacts('{"services":"nope"}')).toEqual([]);
    expect(parseServiceFacts('{"services":[{"notes":"missing name"},{"name":"","notes":"x"}]}')).toEqual([]);
    expect(parseServiceFacts('{"services":[{"name":123,"notes":"x"}]}')).toEqual([]);
    expect(parseServiceFacts("{broken")).toEqual([]);
  });

  it("drops absurdly long names and defaults missing notes", () => {
    expect(parseServiceFacts(`{"services":[{"name":"${"x".repeat(81)}"}]}`)).toEqual([]);
    expect(parseServiceFacts('{"services":[{"name":"svc"}]}')).toEqual([{ name: "svc", notes: "" }]);
  });
});

describe("upsertService", () => {
  const base: ServiceFact[] = [{ name: "Payments-API", notes: "tier 1", updatedAt: 1 }];

  it("adds a new service", () => {
    const out = upsertService(base, { name: "ledger", notes: "pg" }, 5);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ name: "ledger", notes: "pg", updatedAt: 5 });
  });

  it("merges into an existing service case-insensitively, appending new notes", () => {
    const out = upsertService(base, { name: "payments-api", notes: "owned by checkout" }, 9);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Payments-API");
    expect(out[0].notes).toBe("tier 1 owned by checkout");
    expect(out[0].updatedAt).toBe(9);
  });

  it("does not duplicate notes already present", () => {
    const out = upsertService(base, { name: "payments-api", notes: "Tier 1" }, 9);
    expect(out[0].notes).toBe("tier 1");
  });

  it("does not mutate its input", () => {
    upsertService(base, { name: "payments-api", notes: "more" }, 9);
    expect(base[0].notes).toBe("tier 1");
  });
});

describe("buildChatContext", () => {
  it("puts services and summary into the system message, then recent messages", () => {
    const ctx = buildChatContext(
      {
        summary: "we fixed the index",
        messages: turn(3),
        services: [{ name: "api", notes: "go", updatedAt: 0 }],
      },
      "SYS",
    );
    expect(ctx[0].role).toBe("system");
    expect(ctx[0].content).toContain("SYS");
    expect(ctx[0].content).toContain("- api: go");
    expect(ctx[0].content).toContain("we fixed the index");
    expect(ctx.slice(1)).toEqual(turn(3));
  });

  it("omits empty sections", () => {
    const ctx = buildChatContext({ summary: "", messages: [], services: [] }, "SYS");
    expect(ctx).toEqual([{ role: "system", content: "SYS" }]);
  });
});
