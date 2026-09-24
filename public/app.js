// Runbook Buddy chat client. No framework, no build step.
// Talks to: POST /api/chat (SSE), GET/DELETE /api/memory.

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const servicesEl = $("services");
const summaryEl = $("summary");
const runbooksEl = $("runbooks");
const form = $("composer");
const input = $("input");
const sendBtn = $("send");

// --- conversation identity (per browser) ------------------------------------
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "c-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function getConversationId() {
  try {
    let id = localStorage.getItem("rb:conversationId");
    if (!id) { id = newId(); localStorage.setItem("rb:conversationId", id); }
    return id;
  } catch { return newId(); }
}
let conversationId = getConversationId();
$("conv-id").textContent = conversationId;

// --- rendering ---------------------------------------------------------------
function addMessage(role, text = "") {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function renderMemory(state) {
  servicesEl.innerHTML = "";
  if (!state.services?.length) {
    servicesEl.innerHTML = '<li class="empty">Tell me about a service you run and it will appear here.</li>';
  } else {
    for (const s of state.services) {
      const li = document.createElement("li");
      const b = document.createElement("b"); b.textContent = s.name;
      const span = document.createElement("span"); span.textContent = s.notes || "no notes yet";
      li.append(b, span);
      servicesEl.appendChild(li);
    }
  }
  if (state.summary) { summaryEl.textContent = state.summary; summaryEl.classList.remove("empty"); }
  else { summaryEl.textContent = "Older messages are summarised here once the history grows past 12 messages."; summaryEl.classList.add("empty"); }

  runbooksEl.innerHTML = "";
  if (!state.runbooks?.length) {
    runbooksEl.innerHTML = '<li class="empty">None yet.</li>';
  } else {
    for (const r of state.runbooks) {
      const li = document.createElement("li");
      li.textContent = r.service;
      const st = document.createElement("span"); st.className = "status"; st.textContent = r.status;
      li.appendChild(st);
      li.title = "Click to show in chat";
      li.onclick = () => { if (r.content) addMessage("assistant", r.content); };
      runbooksEl.appendChild(li);
    }
  }
}

async function loadMemory() {
  const res = await fetch(`/api/memory?conversationId=${encodeURIComponent(conversationId)}`);
  if (!res.ok) return;
  const state = await res.json();
  messagesEl.innerHTML = "";
  if (!state.messages.length) {
    addMessage("system", "Hi. Tell me about a service you run, or describe an incident, and I'll keep notes as we go.");
  }
  for (const m of state.messages) addMessage(m.role, m.content);
  renderMemory(state);
}

// --- sending -------------------------------------------------------------------
let busy = false;
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true; sendBtn.disabled = true;
  addMessage("user", text);
  const bot = addMessage("assistant", "");
  bot.classList.add("streaming");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await readSse(res.body, (token) => {
      bot.textContent += token;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  } catch (e) {
    bot.remove();
    addMessage("error", `Request failed: ${e.message}`);
  } finally {
    bot.classList.remove("streaming");
    busy = false; sendBtn.disabled = false; input.focus();
    // Memory extraction/compaction runs after the reply; give it a moment.
    setTimeout(refreshMemoryOnly, 2500);
    setTimeout(refreshMemoryOnly, 8000);
  }
}

async function refreshMemoryOnly() {
  const res = await fetch(`/api/memory?conversationId=${encodeURIComponent(conversationId)}`);
  if (res.ok) renderMemory(await res.json());
}

// Parse Workers AI's SSE format: lines of `data: {"response":"..."}` ending with `data: [DONE]`.
async function readSse(body, onToken) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        if (typeof obj.response === "string" && obj.response) onToken(obj.response);
      } catch { /* partial line, ignore */ }
    }
  }
}

// --- wiring ----------------------------------------------------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = ""; input.style.height = "auto";
  send(text);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});
$("new-conv").addEventListener("click", async () => {
  await fetch(`/api/memory?conversationId=${encodeURIComponent(conversationId)}`, { method: "DELETE" }).catch(() => {});
  conversationId = newId();
  try { localStorage.setItem("rb:conversationId", conversationId); } catch {}
  $("conv-id").textContent = conversationId;
  await loadMemory();
});

loadMemory().catch(() => addMessage("error", "Could not load conversation memory."));
