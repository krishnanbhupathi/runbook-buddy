import { describe, expect, it } from "vitest";
import {
  assembleRunbook,
  buildSectionPrompt,
  DEFAULT_SECTIONS,
  findService,
  MAX_SECTIONS,
  parseOutline,
  parseRunbookCommand,
} from "../src/runbook";

describe("parseOutline", () => {
  it("parses a clean list", () => {
    expect(parseOutline('{"sections":["A","B","C"]}')).toEqual(["A", "B", "C"]);
  });

  it("strips numbering, dedupes, and caps at MAX_SECTIONS", () => {
    const many = Array.from({ length: 10 }, (_, i) => `${i + 1}. Section ${i}`);
    many.push("2) section 1"); // duplicate after normalisation
    const out = parseOutline(JSON.stringify({ sections: many }));
    expect(out).toHaveLength(MAX_SECTIONS);
    expect(out[0]).toBe("Section 0");
    expect(new Set(out.map((s) => s.toLowerCase())).size).toBe(out.length);
  });

  it("falls back to defaults on garbage or too few sections", () => {
    expect(parseOutline("nope")).toBe(DEFAULT_SECTIONS);
    expect(parseOutline('{"sections":["only","two"]}')).toBe(DEFAULT_SECTIONS);
    expect(parseOutline('{"sections":[1,2,3,4]}')).toBe(DEFAULT_SECTIONS);
    expect(parseOutline("{bad json")).toBe(DEFAULT_SECTIONS);
  });
});

describe("assembleRunbook", () => {
  it("numbers sections and stamps the date", () => {
    const md = assembleRunbook(
      "orders-api",
      [
        { title: "First", body: "  do this  \n" },
        { title: "Second", body: "then that" },
      ],
      new Date("2026-09-24T10:00:00Z"),
    );
    expect(md.startsWith("# Runbook: orders-api")).toBe(true);
    expect(md).toContain("2026-09-24");
    expect(md).toContain("## 1. First\n\ndo this\n");
    expect(md).toContain("## 2. Second\n\nthen that\n");
  });
});

describe("buildSectionPrompt", () => {
  it("includes service facts, the outline and the target section", () => {
    const p = buildSectionPrompt({ service: "svc", notes: "go, pg", summary: "" }, "Mitigation", ["Checks", "Mitigation"]);
    expect(p[1].content).toContain("Service: svc");
    expect(p[1].content).toContain("Known facts: go, pg");
    expect(p[1].content).toContain("Checks | Mitigation");
    expect(p[1].content).toContain('titled: "Mitigation"');
    expect(p[1].content).not.toContain("Recent conversation context");
  });
});

describe("parseRunbookCommand", () => {
  it("extracts the service name", () => {
    expect(parseRunbookCommand("/runbook orders-api")).toBe("orders-api");
    expect(parseRunbookCommand("  /RUNBOOK   my svc  ")).toBe("my svc");
  });
  it("returns null for ordinary messages", () => {
    expect(parseRunbookCommand("tell me about /runbook")).toBeNull();
    expect(parseRunbookCommand("/runbook")).toBeNull();
    expect(parseRunbookCommand("/runbooks x")).toBeNull();
  });
});

describe("findService", () => {
  const services = [{ name: "Orders-API" }, { name: "ledger" }];
  it("matches case-insensitively and trims", () => {
    expect(findService(services, " orders-api ")?.name).toBe("Orders-API");
  });
  it("returns undefined when absent", () => {
    expect(findService(services, "nope")).toBeUndefined();
  });
});
