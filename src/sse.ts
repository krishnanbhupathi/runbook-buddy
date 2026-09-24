/**
 * Workers AI streams Server-Sent Events. The browser can consume that directly,
 * but the Worker also needs the final text to store in memory. `teeSse` passes
 * the stream through untouched while accumulating the `response` fragments.
 */
export function teeSse(source: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  text: Promise<string>;
} {
  const [toClient, toParse] = source.tee();
  const text = collectSseText(toParse);
  return { stream: toClient, text };
}

export async function collectSseText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) out += parseSseLine(line);
  }
  out += parseSseLine(buffer);
  return out;
}

export function parseSseLine(line: string): string {
  if (!line.startsWith("data:")) return "";
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const obj = JSON.parse(payload) as { response?: unknown };
    return typeof obj.response === "string" ? obj.response : "";
  } catch {
    return "";
  }
}
