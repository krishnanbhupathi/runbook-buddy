/**
 * Cloudflare Workflow: durable, multi-step runbook generation.
 *
 * Each `step.do` is checkpointed: if a step throws, only that step is retried
 * (with the configured backoff), and if the Workflow is evicted or the
 * underlying machine dies, execution resumes from the last completed step.
 * That is what makes it the right tool for a chain of LLM calls, which are
 * slow and fail transiently.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./types";
import { complete } from "./llm";
import {
  assembleRunbook,
  buildOutlinePrompt,
  buildSectionPrompt,
  parseOutline,
  type RunbookInput,
} from "./runbook";

export interface RunbookParams extends RunbookInput {
  conversationId: string;
}

const RETRY = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } } as const;

export class RunbookWorkflow extends WorkflowEntrypoint<Env, RunbookParams> {
  async run(event: WorkflowEvent<RunbookParams>, step: WorkflowStep) {
    const params = event.payload;
    const convo = this.env.CONVERSATION.getByName(params.conversationId);
    const createdAt = event.timestamp.getTime();

    try {
      // Step 1: outline. The model returns JSON; parseOutline tolerates noise.
      const sections = await step.do("outline", RETRY, async () => {
        const raw = await complete(this.env.AI, buildOutlinePrompt(params), {
          maxTokens: 300,
          temperature: 0.2,
        });
        return parseOutline(raw);
      });

      // Step 2..n: one checkpointed step per section, so a flaky call redoes
      // only its own section rather than the whole runbook.
      const drafted: { title: string; body: string }[] = [];
      for (const [i, title] of sections.entries()) {
        const body = await step.do(`section ${i + 1}: ${title}`, RETRY, async () => {
          const text = await complete(this.env.AI, buildSectionPrompt(params, title, sections), {
            maxTokens: 500,
            temperature: 0.3,
          });
          if (!text) throw new Error(`empty section body for "${title}"`);
          return text;
        });
        drafted.push({ title, body });
      }

      // Final step: assemble and persist into the conversation's Durable Object.
      const content = await step.do("assemble and store", async () => {
        const md = assembleRunbook(params.service, drafted, new Date(createdAt));
        await convo.upsertRunbook({
          workflowId: event.instanceId,
          service: params.service,
          content: md,
          status: "complete",
          createdAt,
        });
        return md;
      });

      return { status: "complete", sections: sections.length, bytes: content.length };
    } catch (err) {
      // A step that exhausted its retries lands here. Record the failure so the
      // UI stops polling and the user sees what happened.
      await step.do("record failure", async () => {
        await convo.upsertRunbook({
          workflowId: event.instanceId,
          service: params.service,
          content: `Runbook generation failed: ${err instanceof Error ? err.message : String(err)}`,
          status: "failed",
          createdAt,
        });
      });
      throw err;
    }
  }
}
