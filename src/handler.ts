import type { AppCtx, AppHandler } from "@sauna/apps-runtime";
import { Hono } from "hono";
import OpenAI from "openai";
import { makeDb, conversations } from "./db";
import { DUCKTAPE_CLI_B64, INSTALL_SH_B64 } from "./cli-assets";

type Env = { sql: any; websocket: any; ctx: AppCtx };
const app = new Hono<{ Bindings: Env }>();

const llm = new OpenAI({ baseURL: "https://sauna.local/v1/llms", apiKey: "sauna" });

const VOICE_ID = "ys3XeJJA4ArWMhRpcX1D";

const SYSTEM_PROMPT = `You are DuckTape 🦆 — the AI rubber duck that never forgets. You are an expert software engineer and a friendly debugging partner.

You have long-term memory. Everything remembered about this developer is listed below as MEMORIES. Use it to skip re-asking questions they've already answered (project name, framework, backend, past bugs, coding preferences, current task).

Style:
- Be concise. 2-4 sentences for a typical reply. No code blocks unless the user asks for code or you're showing a fix.
- Speak naturally — the user is talking to you with their voice.
- Don't repeat back the user's memory verbatim; reference it naturally ("Since you're on Next.js with Supabase…").
- If you don't have memory yet, ask one short grounding question to start filling it.

If the user mentions anything long-term-worthy (project name, framework, language, libraries, a bug + its fix, a preference, what they're currently working on), acknowledge it briefly so the extraction step can save it.`;

const EXTRACTION_PROMPT = `You are a memory extractor for DuckTape, an AI coding assistant.

Given the latest conversation turn (user message + assistant reply), extract any long-term information that would be useful for future coding conversations.

Return ONLY valid JSON — no markdown fences, no explanation, no extra text. The shape:

{
  "project": { "key": "value", ... },
  "preferences": { "key": "value", ... },
  "bugs": [ { "issue": "...", "solution": "..." } ],
  "tasks": [ { "description": "..." } ]
}

Rules:
- Only include facts actually present in this turn — do not invent.
- Omit any section that has nothing to add (use {} or []).
- Values must be short strings (no sentences, no markdown).
- Keys must be stable identifiers — snake_case or kebab-case. For project fields use: name, framework, backend, language, database, libraries, hosting. For preferences: component_style, styling, code_style, testing_framework, language.
- If the user mentions a past bug, include the issue AND the solution if both are stated. If only one is stated, leave the other as "unknown".
- If the user states what they're currently working on, include it as a task.`;

// --- Memory helpers (raw env.sql) --------------------------------------------

type MemoryRow = { id: number; type: string; key: string; value: string; created_at: number };

function q<T>(env: Env, sql: string, params: any[]): T[] {
  return (env.sql as any).query(sql, params) as T[];
}

function formatMemories(rows: { type: string; key: string; value: string }[]) {
  if (rows.length === 0) return "(no memories yet — ask one short grounding question)";
  const grouped: Record<string, string[]> = {};
  for (const r of rows) (grouped[r.type] ??= []).push(`  - ${r.key}: ${r.value}`);
  const order = ["project", "preferences", "task", "bug"];
  const lines: string[] = [];
  for (const t of order) {
    if (!grouped[t]) continue;
    lines.push(`${t.toUpperCase()}:`);
    lines.push(grouped[t].join("\n"));
  }
  return lines.join("\n");
}

function saveExtractedMemories(env: Env, extracted: any, now: number): number {
  let saved = 0;
  const upsert = (type: string, key: string, value: string) => {
    const existing = q<{ id: number; value: string }>(
      env, "SELECT id, value FROM memories WHERE type = ? AND key = ? LIMIT 1", [type, key]
    );
    if (existing.length > 0) {
      if (existing[0].value !== value) {
        (env.sql as any).exec("UPDATE memories SET value = ?, created_at = ? WHERE id = ?", [value, now, existing[0].id]);
        saved++;
      }
    } else {
      (env.sql as any).exec("INSERT INTO memories (type, key, value, created_at) VALUES (?, ?, ?, ?)", [type, key, value, now]);
      saved++;
    }
  };
  if (extracted?.project && typeof extracted.project === "object") {
    for (const [k, v] of Object.entries(extracted.project)) {
      if (typeof v === "string" && v.trim()) upsert("project", k, v.trim());
    }
  }
  if (extracted?.preferences && typeof extracted.preferences === "object") {
    for (const [k, v] of Object.entries(extracted.preferences)) {
      if (typeof v === "string" && v.trim()) upsert("preferences", k, v.trim());
    }
  }
  if (Array.isArray(extracted?.bugs)) {
    for (const b of extracted.bugs) {
      if (!b?.issue) continue;
      const key = b.issue.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
      const value = b.solution && b.solution !== "unknown" ? `${b.issue} → ${b.solution}` : b.issue;
      upsert("bug", key, value);
    }
  }
  if (Array.isArray(extracted?.tasks)) {
    for (const t of extracted.tasks) {
      if (!t?.description) continue;
      const key = t.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
      upsert("task", key, t.description.trim());
    }
  }
  return saved;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

async function extractMemories(userMessage: string, assistantReply: string): Promise<any> {
  try {
    const res = await llm.responses.create({
      model: "fast",
      instructions: EXTRACTION_PROMPT,
      input: [{ role: "user", content: `USER: ${userMessage}\n\nASSISTANT: ${assistantReply}` }],
    });
    const text = (res.output_text ?? "").trim();
    const jsonOnly = extractFirstJsonObject(text);
    if (!jsonOnly) throw new Error("no JSON object in extractor output");
    return JSON.parse(jsonOnly);
  } catch (e) {
    console.error("memory extraction failed", e);
    return null;
  }
}

// --- ElevenLabs STT + TTS ----------------------------------------------------

async function transcribeAudio(audio: File): Promise<string> {
  const form = new FormData();
  form.append("file", audio, audio.name || "audio.webm");
  form.append("model_id", "scribe_v2");
  const res = await fetch("https://sauna.local/v1/elevenlabs/v1/speech-to-text", { method: "POST", body: form });
  if (!res.ok) throw new Error(`STT failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { text?: string };
  return (data.text ?? "").trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function synthesizeSpeech(text: string): Promise<string | null> {
  try {
    const cleanText = stripMarkdown(text).slice(0, 4500);
    if (!cleanText) return null;
    const url = `https://sauna.local/v1/elevenlabs/v1/text-to-speech/${VOICE_ID}?output_format=mp3_22050_32`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      console.error("TTS failed", res.status, await res.text());
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch (e) {
    console.error("TTS error", e);
    return null;
  }
}

// --- Routes ------------------------------------------------------------------

app.get("/api/memories", async (c) => {
  const rows = q<MemoryRow>(c.env, "SELECT * FROM memories ORDER BY created_at DESC", []);
  return c.json({ memories: rows });
});

app.delete("/api/memories", async (c) => {
  (c.env.sql as any).exec("DELETE FROM memories", []);
  (c.env.sql as any).exec("DELETE FROM conversations", []);
  return c.json({ ok: true });
});

app.get("/api/conversations", async (c) => {
  const db = makeDb(c.env);
  const rows = await db.query.conversations.findMany({
    orderBy: (t, { desc }: any) => desc(t.createdAt),
    limit: 30,
  });
  return c.json({ conversations: rows.reverse() });
});

app.post("/api/chat", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let userMessage = "";
  let transcript = "";

  if (contentType.includes("application/json")) {
    const body = await c.req.json<{ message?: string }>();
    userMessage = (body.message ?? "").trim();
  } else if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    const audio = form.audio;
    if (audio instanceof File) {
      try { transcript = await transcribeAudio(audio); }
      catch (e: any) {
        console.error("STT error", e);
        return c.json({ error: `transcription failed: ${e?.message ?? e}` }, 500);
      }
      userMessage = transcript.trim();
    }
  }

  if (!userMessage) return c.json({ error: "empty message" }, 400);

  const db = makeDb(c.env);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(conversations).values({ role: "user", content: userMessage, createdAt: now }).run();

  const memoryRows = q<{ type: string; key: string; value: string }>(
    c.env, "SELECT type, key, value FROM memories ORDER BY created_at DESC LIMIT 200", []
  );
  const memoryBlock = formatMemories(memoryRows);
  const prompt = `${SYSTEM_PROMPT}\n\nMEMORIES:\n${memoryBlock}`;

  let reply: string;
  try {
    const res = await llm.responses.create({
      model: "balanced",
      instructions: prompt,
      input: [{ role: "user", content: userMessage }],
    });
    reply = (res.output_text ?? "").trim() || "Hmm, I had nothing to say.";
  } catch (e: any) {
    console.error("LLM error", e);
    reply = `Sorry — I couldn't reach my brain just now. (${e?.message ?? e})`;
  }

  await db.insert(conversations).values({ role: "assistant", content: reply, createdAt: now + 1 }).run();

  let savedCount = 0;
  try {
    const extracted = await extractMemories(userMessage, reply);
    if (extracted) savedCount = saveExtractedMemories(c.env, extracted, now + 2);
  } catch (e) {
    console.error("memory extraction pipeline error", e);
  }

  const audio = await synthesizeSpeech(reply);

  return c.json({ text: reply, audio, transcript, savedMemories: savedCount });
});

// Point-and-explain: the cursor buddy sends whatever the user pointed at
// (an element's text, a code snippet, a page region) and DuckTape explains it.
app.post("/api/explain", async (c) => {
  const body = await c.req.json<{ content?: string; hint?: string; wantAudio?: boolean }>();
  const content = (body.content ?? "").trim().slice(0, 6000);
  if (!content) return c.json({ error: "nothing to explain" }, 400);
  const hint = (body.hint ?? "").trim();

  const memoryRows = q<{ type: string; key: string; value: string }>(
    c.env, "SELECT type, key, value FROM memories ORDER BY created_at DESC LIMIT 200", []
  );
  const memoryBlock = formatMemories(memoryRows);

  const instructions = `You are DuckTape 🦆 — a friendly AI coding buddy that lives near the user's cursor. The user just POINTED at something on their screen and wants you to explain it fast and clearly.

What you know about this developer (use it to tailor the depth and reference their stack):
${memoryBlock}

Rules:
- Explain what they pointed at in plain language. Lead with the one-sentence "what this is", then 2-4 short lines of why it matters / how it works / what to watch for.
- If it's code, say what it does and flag anything risky or non-obvious.
- If it's an error or log line, say the likely cause and the first thing to try.
- If it's UI text or a control, say what it does.
- Be concise and spoken-friendly (this may be read aloud). No long code blocks unless a 1-3 line fix is genuinely the answer.`;

  const userContent = hint
    ? `The user pointed at this and asked: "${hint}"\n\n---\n${content}`
    : `The user pointed at this on their screen:\n\n---\n${content}`;

  let text: string;
  try {
    const res = await llm.responses.create({
      model: "balanced",
      instructions,
      input: [{ role: "user", content: userContent }],
    });
    text = (res.output_text ?? "").trim() || "I couldn't make sense of that one.";
  } catch (e: any) {
    console.error("explain LLM error", e);
    return c.json({ error: `explain failed: ${e?.message ?? e}` }, 502);
  }

  const audio = body.wantAudio ? await synthesizeSpeech(text) : null;
  return c.json({ text, audio });
});


// ---- CLI: token-gated endpoints (shared brain + memory for the terminal) ----

function getOrCreateToken(env: Env): string {
  const rows = q<{ value: string }>(env, "SELECT value FROM config WHERE key = 'cli_token' LIMIT 1", []);
  if (rows.length > 0) return rows[0].value;
  const token = "dt_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  (env.sql as any).exec("INSERT INTO config (key, value) VALUES ('cli_token', ?)", [token]);
  return token;
}

function cliAuthed(c: any): boolean {
  const expected = getOrCreateToken(c.env);
  const got = (c.req.header("x-ducktape-token") ?? "").trim();

  return !!got && got === expected;
}

async function runExplain(env: Env, content: string, hint: string): Promise<string> {
  const memoryRows = q<{ type: string; key: string; value: string }>(
    env, "SELECT type, key, value FROM memories ORDER BY created_at DESC LIMIT 200", []
  );
  const memoryBlock = formatMemories(memoryRows);
  const instructions = `You are DuckTape 🦆 — a friendly AI coding buddy in the user's terminal. Explain what they hand you fast and clearly.\n\nWhat you know about this developer:\n${memoryBlock}\n\nRules: Lead with a one-line "what this is", then 2-4 short lines of why/how/what-to-watch. For code, say what it does and flag anything risky. For an error/log, give the likely cause and first thing to try. Be concise and terminal-friendly (plain text, minimal formatting).`;
  const res = await llm.responses.create({
    model: "balanced",
    instructions,
    input: [{ role: "user", content: hint ? `${hint}\n\n---\n${content}` : content }],
  });
  return (res.output_text ?? "").trim() || "I couldn't make sense of that one.";
}

// Owner-only (platform gates /admin/*): fetch the CLI token to paste into `ducktape login`.
app.get("/admin/cli-token", async (c) => {
  const token = getOrCreateToken(c.env);
  const url = new URL(c.req.url);
  const appUrl = `${url.protocol}//${url.host}`;
  return c.json({ token, appUrl, install: `curl -fsSL ${appUrl}/cli/install.sh | bash`, login: `ducktape login ${token}` });
});

// Anonymous (public_paths) but bearer-token gated: serve the installer + CLI source.
app.get("/cli/install.sh", (c) => c.text(atob(INSTALL_SH_B64), 200, { "content-type": "text/x-shellscript; charset=utf-8" }));
app.get("/cli/ducktape.mjs", (c) => c.text(atob(DUCKTAPE_CLI_B64), 200, { "content-type": "text/javascript; charset=utf-8" }));

app.post("/cli/chat", async (c) => {
  if (!cliAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const { message } = await c.req.json<{ message?: string }>();
  const msg = (message ?? "").trim();
  if (!msg) return c.json({ error: "empty message" }, 400);
  const db = makeDb(c.env);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(conversations).values({ role: "user", content: msg, createdAt: now }).run();
  const memoryRows = q<{ type: string; key: string; value: string }>(
    c.env, "SELECT type, key, value FROM memories ORDER BY created_at DESC LIMIT 200", []
  );
  const prompt = `${SYSTEM_PROMPT}\n\nMEMORIES:\n${formatMemories(memoryRows)}`;
  let reply: string;
  try {
    const res = await llm.responses.create({ model: "balanced", instructions: prompt, input: [{ role: "user", content: msg }] });
    reply = (res.output_text ?? "").trim() || "Hmm, I had nothing to say.";
  } catch (e: any) {
    return c.json({ error: `llm failed: ${e?.message ?? e}` }, 502);
  }
  await db.insert(conversations).values({ role: "assistant", content: reply, createdAt: now + 1 }).run();
  try {
    const extracted = await extractMemories(msg, reply);
    if (extracted) saveExtractedMemories(c.env, extracted, now + 2);
  } catch (e) { console.error("cli extract error", e); }
  return c.json({ text: reply });
});

app.post("/cli/explain", async (c) => {
  if (!cliAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ content?: string; hint?: string }>();
  const content = (body.content ?? "").trim().slice(0, 6000);
  if (!content) return c.json({ error: "nothing to explain" }, 400);
  try {
    const text = await runExplain(c.env, content, (body.hint ?? "").trim());
    return c.json({ text });
  } catch (e: any) {
    return c.json({ error: `explain failed: ${e?.message ?? e}` }, 502);
  }
});


export default {
  fetch: (request, env, ctx) => app.fetch(request, { ...env, ctx }),
} satisfies AppHandler;
