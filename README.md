# DuckTape 🦆

**The AI rubber duck that never forgets.**

A voice-first AI coding assistant. Talk to it like you'd talk to a rubber duck, except this one talks back, remembers what you told it last week, and can point at things on the page to explain them.

## What's inside

- **Voice in, voice out** — speech-to-text and text-to-speech via [ElevenLabs](https://elevenlabs.io).
- **Real coding conversation** — powered by an LLM.
- **Persistent memory** — an app-owned SQLite store that remembers your projects, preferences, bugs, and tasks across sessions, and re-reads them into every reply.
- **Cursor buddy** — a floating duck that eases along next to your cursor and explains whatever you point at.
- **A quack** — because of course.

## How it's built

It's a [Sauna App](https://sauna.ai): a single deployed handler with its own URL, database, and static frontend.

- `src/handler.ts` — the HTTP handler (chat, memory, and CLI endpoints).
- `src/client.tsx` — the voice-first chat UI.
- `src/schema.ts` / `src/db.ts` — the Drizzle schema and client for the memory store.
- `migrations/` — the SQLite migrations applied on boot.
- `public/` — the frontend assets, the duck mascot clip, and the quack.
- `cli/` — a small CLI installer.
- `app.md` — the app manifest + longer technical notes.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` | `/` | the voice-first chat UI |
| `GET` | `/api/memories` | all stored memories, newest first |
| `GET` | `/api/conversations` | recent conversation turns (last 30) |
| `POST` | `/api/chat` | send `{ message }` (JSON) or `multipart/form-data` with an `audio` field; returns `{ text, audio }` (base64 MP3) |
| `POST` | `/api/memories` | add a memory `{ type, key, value }` |
| `DELETE` | `/api/memories/:id` | remove a memory |

## Memory model

Memories live in a `memories` table with a `type` (`project` \| `preferences` \| `bug` \| `task`), a stable `key`, and a `value`. They're read into the prompt on every turn and re-extracted after each reply, so DuckTape gets to know you the more you use it.

---

*Built on [Sauna](https://sauna.ai).*
