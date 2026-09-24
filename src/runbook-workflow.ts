/** Placeholder; implemented in milestone 4. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./types";

export class RunbookWorkflow extends WorkflowEntrypoint<Env, { conversationId: string; service: string }> {
  async run(_event: WorkflowEvent<{ conversationId: string; service: string }>, _step: WorkflowStep) {
    return { status: "not implemented" };
  }
}
