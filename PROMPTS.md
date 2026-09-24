# Prompt history

Cloudflare's assignment asks for the prompt history behind AI-assisted code. This file
records every prompt given to the AI assistant (Claude Code, model Claude Fable 5.1), in
order, with a one-line note of what each produced. Prompts are verbatim; only the
assistant's output is summarised.

---

## 1. Initial task brief

> # Task: Build Cloudflare's optional AI-app assignment for two job applications
>
> ## Who I am
> Bhupathi Murali Krishna, backend/platform engineer (Java, Python, TypeScript; Kafka, PostgreSQL,
> Temporal, Docker, AWS). GitHub: github.com/krishnanbhupathi. I have NOT used Cloudflare Workers,
> Workers AI, Durable Objects, Workflows or Pages before, so explain Cloudflare-specific concepts
> briefly as we go and prefer the official docs (developers.cloudflare.com).
>
> ## Context
> I am applying to two Cloudflare roles via Greenhouse:
> - Software Engineer (job 8212060) — infrastructure platform team
> - Software Engineer, Platforms & Productivity (job 8168623) — Developer Productivity team that
>   builds internal tooling, MCP servers, AI agents and evals
> Both application forms are already fully filled (CV + cover letter) in Chrome and are UNSUBMITTED.
> Each has an optional field: "Please share GitHub repo URL for the project here." Cloudflare says
> they fast-track candidates who complete it. Once the repo is done I paste the URL into both forms
> and submit.
>
> ## The assignment (verbatim requirements from the form)
> Build a type of AI-powered application on Cloudflare. It should include the following components:
> - LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
> - Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
> - User input via chat or voice (recommend using Pages or Realtime)
> - Memory or state
> Note from Cloudflare: "AI-assisted coding is encouraged, but you have to submit prompt history."
>
> ## What I want built
> A small but complete, genuinely working app, not a toy. Proposed scope (adjust if you see a
> better fit, but keep all four required components):
> 1. Chat UI on Cloudflare Pages (simple, clean, no framework bloat; plain HTML/TS or minimal
>    framework).
> 2. A Worker API that calls Llama 3.3 on Workers AI for responses.
> 3. A Durable Object per conversation holding memory/state (message history, summary, user prefs).
> 4. A Cloudflare Workflow for one multi-step action the assistant can trigger (e.g. a
>    "research and summarize" or "plan and execute" task with retries), so the
>    Workflow/coordination component is real, not decorative.
> 5. Streaming responses if cheap to add; otherwise plain request/response.
> Theme suggestion (pick one or propose better): a "reliability runbook assistant" that keeps
> per-user memory of their services and walks through incident checklists — fits my backend
> reliability background and the infra-platform role. Keep it honest and small.
>
> ## Hard requirements
> - Public GitHub repo under github.com/krishnanbhupathi, MIT license, clear README:
>   what it does, architecture diagram (text/mermaid), how each of the 4 required components is
>   satisfied, how to run locally (wrangler dev) and deploy (wrangler deploy), and a live demo URL.
> - PROMPTS.md at repo root: append every prompt I give you and a one-line note of what it
>   produced, in order, from the very first commit. This is mandatory for the submission.
> - Tests for the non-trivial logic (memory summarization, workflow steps). Keep them fast.
> - TypeScript, wrangler.toml/jsonc configured for Workers AI, Durable Objects, Workflows, Pages.
> - Small commits with clear messages. Do not commit secrets. Use .dev.vars for local secrets.
> - Do not overstate anything in the README. If a feature is partial, say so.
>
> ## Process
> 1. Start by checking my environment: node, npm, wrangler installed? Am I logged in
>    (`wrangler whoami`)? If not, tell me the exact commands to run myself for login.
> 2. Propose the final architecture and file layout in a short list. Wait for my OK.
> 3. Scaffold, then build in this order: Worker + Workers AI call → Durable Object memory →
>    Pages chat UI → Workflow action → tests → README + PROMPTS.md polish → deploy.
> 4. After each milestone, tell me how to verify it locally in one or two commands.
> 5. When deployed, give me: repo URL, live URL, and a 3-line summary I can mention to a recruiter.
>
> ## Done when
> Repo is public, deployed, README complete, PROMPTS.md complete, and I have the URL to paste
> into the two Cloudflare application forms.
>
> while doing git commit and pushes ask me

**Produced:** environment check (node 20, npm 10, wrangler installed locally as a dev
dependency, `gh` logged in, Cloudflare not logged in), the `wrangler login` instruction, and
the architecture proposal for "Runbook Buddy" (Worker + Workers AI, Durable Object per
conversation, Workflow for runbook generation, static chat UI served by the Worker).

## 2. Login output

> (ran `npx wrangler login`, pasted the successful output)

**Produced:** confirmed the account via `wrangler whoami`; attempted a wrangler upgrade, which
failed on a peer-dependency conflict, so stayed on 4.86.

## 3. Billing question

> This wrangler does cause any billing right?

**Produced:** explanation of Workers Free plan limits for Workers, Workers AI, Durable
Objects and Workflows; no code.

## 4. Billing follow-up

> i have card attached to this account and have my domain purchased and some other things are in free plan

**Produced:** explanation that billing depends on the Workers plan, not the card; asked to
check the Plans page.

## 5. Dashboard screenshot

> (screenshot of the Workers & Pages dashboard showing the Free plan, 0 USD billable usage,
> subdomain krishnanbhupathi.workers.dev)

**Produced:** confirmed Free plan; noted the live URL will be runbook-buddy.krishnanbhupathi.workers.dev.

## 6. Approval

> Ok

**Produced:** milestone 1 scaffold: `package.json`, `wrangler.jsonc` (AI, Durable Object,
Workflow and assets bindings), `tsconfig.json`, `.gitignore`, MIT `LICENSE`,
`.dev.vars.example`, `src/index.ts` with a streaming `POST /api/chat` that calls Llama 3.3 on
Workers AI, `src/llm.ts`, `src/types.ts`, placeholder Durable Object and Workflow classes,
placeholder `public/index.html`, and this file. Verified locally with `wrangler dev` and curl.
Fixed a compatibility_date that was newer than the local runtime supported.

## 7. Commit review

> before commiting show me the commit message
>
> can you remove the Co-Auuthored-By line

**Produced:** first commit made without an AI co-author trailer (user preference for this repo).

**Also produced (milestone 2, no new prompt):** Durable Object memory. `src/memory.ts`
(pure logic: compaction threshold and split, summary and extraction prompts, defensive JSON
parsing, service upsert, chat-context assembly), `src/sse.ts` (tee the SSE stream so the
Worker can store the reply while the browser streams it), `src/conversation-do.ts`
(SQLite tables for messages, summary, services, runbooks; RPC methods; post-turn
maintenance), `src/prompts.ts`, and `/api/memory` GET/DELETE routes. Debugged three issues
found by running it: a non-handler export from the entry module crashes the runtime; Workers
AI non-streaming output is OpenAI-shaped for this model, not `{response}`; the extractor
recorded "Postgres" as a service, fixed by tightening the prompt. Verified compaction by
driving a 14-message conversation.

## 8. Milestone 2 verification and approval

> (pasted the output of the two verification curl commands: streamed reply plus the
> `/api/memory` JSON showing the stored messages and the extracted `checkout-api` service)
>
> commit

**Produced:** second commit.

**Also produced (milestone 3, no new prompt):** chat UI in `public/` (`index.html`,
`style.css`, `app.js`): no framework or build step; conversation ID kept in localStorage;
history restored from `/api/memory` on load; replies streamed token by token by parsing the
SSE body; side panel shows known services, the rolling summary and generated runbooks; "New
conversation" wipes the Durable Object and starts a fresh ID. Verified in Chrome: sent a
message, watched it stream, saw `orders-api` appear in the memory panel, reloaded and saw the
history restored.

## 9. Milestone 3 approval

> commit

**Produced:** third commit.

**Also produced (milestone 4, no new prompt):** the Workflow. `src/runbook.ts` (pure:
outline and section prompts, tolerant outline parser with a default fallback, Markdown
assembly, `/runbook <service>` command parser), `src/runbook-workflow.ts` (`RunbookWorkflow`:
one retried `step.do` for the outline, one per section, one to assemble and write the result
into the conversation's Durable Object; failures are recorded there too), Worker routes
`POST /api/runbook` and `GET /api/runbook/:id`, chat interception of `/runbook <service>`,
and UI support (a "Generate runbook" button per known service, status polling, a small safe
Markdown renderer). Verified locally via curl (5 sections, ~25 s) and in Chrome
(`docs/screenshot.jpg`).

## 10. Milestone 4 approval

> commit

**Produced:** fourth commit.

## 11. Milestone 5 approval

> commit

**Produced:** fifth commit.

**Also produced (milestone 6, no new prompt):** first deploy to
https://runbook-buddy.krishnanbhupathi.workers.dev, smoke-tested live (chat, memory,
Workflow run to completion), and this README with architecture diagram, component mapping,
local/deploy instructions, API table and limitations.

## 12. README approval and publish

> commit and push

**Produced:** sixth commit; public repo github.com/krishnanbhupathi/runbook-buddy created
and `main` pushed.
