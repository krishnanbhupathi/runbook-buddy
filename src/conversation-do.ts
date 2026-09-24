/**
 * One Durable Object instance per conversation. A Durable Object is a single-
 * threaded, globally unique actor with its own persistent storage: all requests
 * for a given conversation ID are routed to the same instance, so reads and
 * writes are strictly ordered with no separate database to coordinate.
 *
 * Storage is the SQLite backend (`new_sqlite_classes` in wrangler.jsonc).
 */
import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, ConversationState, Env, Role, ServiceFact } from "./types";
import { complete } from "./llm";
import {
  buildChatContext,
  buildExtractionPrompt,
  buildSummaryPrompt,
  parseServiceFacts,
  shouldCompact,
  splitForCompaction,
  upsertService,
} from "./memory";

export interface RunbookRecord {
  service: string;
  content: string;
  workflowId: string;
  status: "running" | "complete" | "failed";
  createdAt: number;
}

export class ConversationDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS services (
        name TEXT PRIMARY KEY,
        notes TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runbooks (
        workflow_id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // ---- reads -------------------------------------------------------------

  getState(): ConversationState {
    return {
      summary: this.getMeta("summary") ?? "",
      messages: this.getMessages(),
      services: this.getServices(),
    };
  }

  getRunbooks(): RunbookRecord[] {
    return this.ctx.storage.sql
      .exec<{ workflow_id: string; service: string; content: string; status: string; created_at: number }>(
        "SELECT workflow_id, service, content, status, created_at FROM runbooks ORDER BY created_at DESC",
      )
      .toArray()
      .map((r) => ({
        workflowId: r.workflow_id,
        service: r.service,
        content: r.content,
        status: r.status as RunbookRecord["status"],
        createdAt: r.created_at,
      }));
  }

  /** Messages to send to the chat model for the next turn. */
  buildContext(systemPrompt: string): ChatMessage[] {
    return buildChatContext(this.getState(), systemPrompt);
  }

  // ---- writes ------------------------------------------------------------

  appendMessage(role: Role, content: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)",
      role,
      content,
      Date.now(),
    );
  }

  rememberService(name: string, notes: string): ServiceFact[] {
    const next = upsertService(this.getServices(), { name, notes }, Date.now());
    this.writeServices(next);
    return next;
  }

  upsertRunbook(rec: RunbookRecord): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO runbooks (workflow_id, service, content, status, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id) DO UPDATE SET content = excluded.content, status = excluded.status`,
      rec.workflowId,
      rec.service,
      rec.content,
      rec.status,
      rec.createdAt,
    );
  }

  clear(): void {
    this.ctx.storage.sql.exec("DELETE FROM messages; DELETE FROM meta; DELETE FROM services; DELETE FROM runbooks;");
  }

  /**
   * Post-turn maintenance, run after the assistant has replied:
   *   1. extract service facts from the latest user message,
   *   2. compact old messages into the rolling summary when history is long.
   * Both call the model, so they run off the request's critical path.
   */
  async maintain(latestUserMessage: string): Promise<void> {
    const results = await Promise.allSettled([
      this.extractServices(latestUserMessage),
      this.compactIfNeeded(),
    ]);
    for (const r of results) {
      if (r.status === "rejected") console.error("maintain step failed:", r.reason);
    }
  }

  private async extractServices(userMessage: string): Promise<void> {
    if (userMessage.length < 12) return; // "hi", "ok" etc. cannot contain service facts
    const raw = await complete(this.env.AI, buildExtractionPrompt(userMessage), {
      maxTokens: 300,
      temperature: 0,
    });
    const facts = parseServiceFacts(raw);
    if (facts.length === 0) return;
    let services = this.getServices();
    const now = Date.now();
    for (const f of facts) services = upsertService(services, f, now);
    this.writeServices(services);
  }

  private async compactIfNeeded(): Promise<void> {
    const messages = this.getMessages();
    if (!shouldCompact(messages)) return;
    const { toSummarize, toKeep } = splitForCompaction(messages);
    if (toSummarize.length === 0) return;
    const summary = await complete(
      this.env.AI,
      buildSummaryPrompt(this.getMeta("summary") ?? "", toSummarize),
      { maxTokens: 400, temperature: 0.2 },
    );
    if (!summary) return;
    // Delete everything older than the kept tail. Messages are ordered by id.
    const firstKeptId = this.getMessageIds().slice(-toKeep.length)[0];
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE id < ?", firstKeptId);
    this.setMeta("summary", summary);
  }

  // ---- storage helpers ---------------------------------------------------

  private getMessages(): ChatMessage[] {
    return this.ctx.storage.sql
      .exec<{ role: Role; content: string }>("SELECT role, content FROM messages ORDER BY id")
      .toArray();
  }

  private getMessageIds(): number[] {
    return this.ctx.storage.sql
      .exec<{ id: number }>("SELECT id FROM messages ORDER BY id")
      .toArray()
      .map((r) => r.id);
  }

  private getServices(): ServiceFact[] {
    return this.ctx.storage.sql
      .exec<{ name: string; notes: string; updated_at: number }>(
        "SELECT name, notes, updated_at FROM services ORDER BY updated_at DESC",
      )
      .toArray()
      .map((r) => ({ name: r.name, notes: r.notes, updatedAt: r.updated_at }));
  }

  private writeServices(services: ServiceFact[]): void {
    for (const s of services) {
      this.ctx.storage.sql.exec(
        `INSERT INTO services (name, notes, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`,
        s.name,
        s.notes,
        s.updatedAt,
      );
    }
  }

  private getMeta(key: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0];
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }
}
