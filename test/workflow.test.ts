/**
 * Exercises RunbookWorkflow.run() with a fake `step`, fake AI and a fake
 * Durable Object stub. `cloudflare:workers` is aliased to a stub in
 * vitest.config.ts, so this runs in plain Node in milliseconds.
 */
import { describe, expect, it, vi } from "vitest";
import { RunbookWorkflow, type RunbookParams } from "../src/runbook-workflow";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { RunbookRecord } from "../src/conversation-do";

const ctx = {} as ExecutionContext;

function fakeStep() {
  const names: string[] = [];
  const step = {
    async do<T>(name: string, configOrFn: unknown, maybeFn?: () => Promise<T>): Promise<T> {
      names.push(name);
      const fn = (typeof configOrFn === "function" ? configOrFn : maybeFn) as () => Promise<T>;
      return fn();
    },
  } as unknown as WorkflowStep;
  return { step, names };
}

function fakeEnv(aiRun: (model: string, input: { messages: { content: string }[] }) => Promise<unknown>) {
  const upsertRunbook = vi.fn(async (_rec: RunbookRecord) => {});
  const env = {
    AI: { run: vi.fn(aiRun) },
    CONVERSATION: { getByName: vi.fn(() => ({ upsertRunbook })) },
  } as unknown as ConstructorParameters<typeof RunbookWorkflow>[1];
  return { env, upsertRunbook };
}

const params: RunbookParams = { conversationId: "c-1", service: "orders-api", notes: "go, pg", summary: "" };
const event: WorkflowEvent<RunbookParams> = {
  payload: params,
  timestamp: new Date("2026-09-24T00:00:00Z"),
  instanceId: "wf-123",
  workflowName: "runbook-workflow",
};

describe("RunbookWorkflow", () => {
  it("runs outline, one step per section, then stores the assembled runbook", async () => {
    const { env, upsertRunbook } = fakeEnv(async (_m, input) => {
      const user = input.messages.at(-1)!.content;
      if (user.includes("Write ONLY the section titled")) {
        const title = user.match(/titled: "(.+)"/)![1];
        return { response: `Body for ${title}` };
      }
      return { response: '{"sections":["Checks","Mitigation","Escalation"]}' };
    });
    const { step, names } = fakeStep();

    const result = await new RunbookWorkflow(ctx, env).run(event, step);

    expect(names).toEqual([
      "outline",
      "section 1: Checks",
      "section 2: Mitigation",
      "section 3: Escalation",
      "assemble and store",
    ]);
    expect(result).toMatchObject({ status: "complete", sections: 3 });
    expect(upsertRunbook).toHaveBeenCalledTimes(1);
    const stored = upsertRunbook.mock.calls[0][0];
    expect(stored.status).toBe("complete");
    expect(stored.workflowId).toBe("wf-123");
    expect(stored.content).toContain("# Runbook: orders-api");
    expect(stored.content).toContain("## 2. Mitigation\n\nBody for Mitigation");
  });

  it("falls back to default sections when the outline is unusable", async () => {
    const { env } = fakeEnv(async (_m, input) => {
      const user = input.messages.at(-1)!.content;
      return { response: user.includes("Write ONLY") ? "text" : "I cannot produce JSON, sorry" };
    });
    const { step, names } = fakeStep();
    const result = await new RunbookWorkflow(ctx, env).run(event, step);
    expect(result).toMatchObject({ status: "complete", sections: 5 });
    expect(names.filter((n) => n.startsWith("section"))).toHaveLength(5);
  });

  it("records a failed runbook and rethrows when a section step gives up", async () => {
    const { env, upsertRunbook } = fakeEnv(async (_m, input) => {
      const user = input.messages.at(-1)!.content;
      if (user.includes('titled: "Mitigation"')) throw new Error("model unavailable");
      if (user.includes("Write ONLY")) return { response: "ok" };
      return { response: '{"sections":["Checks","Mitigation","Escalation"]}' };
    });
    const { step, names } = fakeStep();

    await expect(new RunbookWorkflow(ctx, env).run(event, step)).rejects.toThrow("model unavailable");

    expect(names).toEqual(["outline", "section 1: Checks", "section 2: Mitigation", "record failure"]);
    expect(upsertRunbook).toHaveBeenCalledTimes(1);
    const stored = upsertRunbook.mock.calls[0][0];
    expect(stored.status).toBe("failed");
    expect(stored.content).toContain("model unavailable");
  });

  it("treats an empty section body as a failure so the step can retry", async () => {
    const { env } = fakeEnv(async (_m, input) => {
      const user = input.messages.at(-1)!.content;
      return { response: user.includes("Write ONLY") ? "" : '{"sections":["A","B","C"]}' };
    });
    const { step } = fakeStep();
    await expect(new RunbookWorkflow(ctx, env).run(event, step)).rejects.toThrow("empty section body");
  });
});
