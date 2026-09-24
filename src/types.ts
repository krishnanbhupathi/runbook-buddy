/**
 * Shared types. `Env` describes the bindings declared in wrangler.jsonc.
 */
import type { ConversationDO } from "./conversation-do";

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  CONVERSATION: DurableObjectNamespace<ConversationDO>;
  RUNBOOK_WORKFLOW: Workflow;
}

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** A service the user has told the assistant about. Lives in conversation memory. */
export interface ServiceFact {
  name: string;
  /** Free-form notes: tier, owner, dependencies, known failure modes. */
  notes: string;
  updatedAt: number;
}

export interface ConversationState {
  /** Rolling summary of messages that have been compacted out of `messages`. */
  summary: string;
  /** Recent messages kept verbatim. */
  messages: ChatMessage[];
  services: ServiceFact[];
}
