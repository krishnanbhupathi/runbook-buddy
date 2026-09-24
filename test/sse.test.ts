import { describe, expect, it } from "vitest";
import { collectSseText, parseSseLine } from "../src/sse";
import { extractText } from "../src/llm";

describe("parseSseLine", () => {
  it("extracts the response fragment", () => {
    expect(parseSseLine('data: {"response":"Hel","x":1}')).toBe("Hel");
  });
  it("ignores non-data, [DONE], empty and malformed lines", () => {
    expect(parseSseLine("event: ping")).toBe("");
    expect(parseSseLine("data: [DONE]")).toBe("");
    expect(parseSseLine("data:")).toBe("");
    expect(parseSseLine("data: {not json")).toBe("");
    expect(parseSseLine('data: {"response":5}')).toBe("");
  });
});

describe("collectSseText", () => {
  it("reassembles fragments even when chunks split a line", () => {
    const enc = new TextEncoder();
    const chunks = ['data: {"response":"Hel', 'lo"}\n\ndata: {"resp', 'onse":" world"}\n\ndata: [DONE]\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    return expect(collectSseText(stream)).resolves.toBe("Hello world");
  });
});

describe("extractText (Workers AI response shapes)", () => {
  it("handles legacy, OpenAI-style, nested and string shapes", () => {
    expect(extractText({ response: " hi " })).toBe("hi");
    expect(extractText({ choices: [{ message: { content: "yo" } }] })).toBe("yo");
    expect(extractText({ response: { choices: [{ message: { content: "deep" } }] } })).toBe("deep");
    expect(extractText("plain")).toBe("plain");
  });
  it("returns empty for unknown shapes", () => {
    expect(extractText(null)).toBe("");
    expect(extractText({ foo: 1 })).toBe("");
  });
});
