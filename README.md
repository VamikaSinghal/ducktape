# DuckTape 🦆

### The AI coding assistant that never forgets.

I'm a CS student at Berkeley, and like a lot of my generation, I learned to code by vibing — prompting an AI until something works, without always understanding why. It's fast, and it feels like magic, right up until it crashes. Then I'm stuck, because I never actually learned the thing that broke.

DuckTape is my attempt to fix that. It's an AI coding buddy that talks to you like a real rubber duck — the old programmer's trick of explaining your problem out loud until the answer clicks. Except this duck talks back, and it *remembers*. It knows what you're building, what broke last time, and how you like to work — so every conversation builds on the last one instead of starting from zero.

The goal isn't just to spit out fixes. It's to bring back the part of coding that vibing has quietly erased — the understanding, the back-and-forth, the "oh, THAT'S why it broke" moment. We grew up not really knowing what the duck was for. I want to give it meaning again.

Built for the **Sauna × ElevenLabs** hackathon.

> Tell the web duck about a bug today, and your terminal duck knows about it tomorrow. One brain, one memory, everywhere.

---

## What DuckTape does

- 🎙️ **Talks with you, out loud** — speak to it, it speaks back (voice in, voice out).
- 🧠 **Never forgets** — remembers your project, stack, bugs, and fixes across every conversation.
- 📋 **Shows its memory** — a live panel of everything it knows about you.
- 👉 **Point & explain** — point at any code on the page, it explains it out loud.
- 💻 **Lives in your terminal** — a CLI with the same brain and memory as the web app.
- 🔗 **One brain, everywhere** — web, voice, and terminal all share a single memory.
- 🎓 **Teaches, doesn't just fix** — closes the understanding gap vibe-coding leaves behind.

## The "wow" moment

**Conversation 1:** *"I'm building Doppl with Next.js and Supabase. I finally fixed my auth redirect loop — it was my middleware matcher."*

**Conversation 2 (fresh session):** *"My login broke again."*
→ *"Ugh, again? Last time it was that middleware matcher causing the redirect loop on Doppl's auth flow — same symptom, or something new?"*

No re-explaining. That's the whole point.

---

## Architecture

```
You (voice / text / terminal)
        ↓
ElevenLabs STT ──► DuckTape backend ──► retrieve memories
                        ↓                     ↓
                   inject into prompt ──► LLM ──► reply
                        ↓                     ↓
                 extract new memories    ElevenLabs TTS
                        ↓                     ↓
                   store in SQLite       voice response
```

- **Frontend:** React + Tailwind (light white & yellow theme), single-page.
- **Backend:** [Hono](https://hono.dev/) on Sauna Apps (Cloudflare Durable Object facet).
- **Database:** app-owned SQLite via Drizzle ORM — `memories`, `conversations`, `config`.
- **Voice:** ElevenLabs (Scribe STT + Flash v2.5 TTS) via the Sauna proxy.
- **LLM:** Sauna's metered LLM endpoint (`balanced` for chat/explain, `fast` for memory extraction).

## Project layout

```
app.md              # Sauna app manifest + README
package.json        # deps (hono, drizzle-orm, react, openai)
src/
  handler.ts        # Hono backend: /api/chat, /api/explain, /cli/*, memory pipeline
  client.tsx        # React UI: chat, memory panel, cursor buddy, point-mode
  schema.ts         # Drizzle schema (memories, conversations, config)
  db.ts             # sqlite-proxy adapter
  cli-assets.ts     # base64 of the CLI + installer (served from /cli/*)
public/             # index.html + duck mascot (mp4/webm), quack.mp3, favicon
migrations/         # Drizzle migrations (applied at boot)
cli/
  ducktape.mjs      # the terminal CLI (zero deps, Node 18+)
  install.sh        # one-line installer
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | The voice-first chat UI |
| `GET` | `/api/memories` | All stored memories |
| `GET` | `/api/conversations` | Recent conversation turns |
| `POST` | `/api/chat` | Chat (JSON `{message}` or multipart `audio`) → `{text, audio}` |
| `POST` | `/api/explain` | Point-and-explain (used by the cursor buddy) |
| `GET` | `/cli/install.sh` | The CLI installer (anonymous) |
| `GET` | `/cli/ducktape.mjs` | The CLI source (anonymous) |
| `POST` | `/cli/chat` · `/cli/explain` | CLI endpoints (token-gated via `X-DuckTape-Token`) |
| `GET` | `/admin/cli-token` | Owner-only: fetch your CLI token |

## The terminal CLI

```bash
# install
curl -fsSL https://<your-app>.sauna.new/cli/install.sh | bash

# log in (token from /admin/cli-token)
ducktape login <token>

# use it
ducktape ask "why is my login redirect looping"
ducktape explain src/middleware.ts
npm run build 2>&1 | ducktape          # pipe an error → explanation
```

The CLI is a thin client — it calls the deployed app, which owns the brain and the memory. So it shares context with the web app: same project, same bugs, same you.

## Running it

This is a [Sauna App](https://sauna.new). Drop the folder in at `apps/ducktape/` and deploy through Sauna — migrations apply on boot, and voice + LLM are metered through Sauna's proxy (no API keys to manage).

---

Made with 🦆 for the Sauna × ElevenLabs hackathon.
