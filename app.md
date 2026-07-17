---
name: ducktape
description: DuckTape — voice-first AI coding assistant with persistent memory.
manifest_version: 1
enabled: true
visibility: private
public_paths:
  - /cli/*
---

# DuckTape 🦆

The AI rubber duck that never forgets.

A voice-first AI coding assistant that combines:

- **ElevenLabs** (via the Sauna proxy) for speech-to-text and text-to-speech
- **Sauna's own LLM** (`balanced` tier) for coding conversation
- **SQLite inside this app** for persistent, long-term memory across sessions

## Endpoints

- `GET  /` — the voice-first chat UI
- `GET  /api/memories` — all stored memories, ordered by recency
- `GET  /api/conversations` — recent conversation turns (last 30)
- `POST /api/chat` — accepts `{ message }` (JSON) or `multipart/form-data` with `audio` field; returns `{ text, audio }` (base64 MP3)
- `POST /api/memories` — manually add a memory `{ type, key, value }` (Phase 6)
- `DELETE /api/memories/:id` — remove a memory (Phase 6)

## Memory model

Memories are stored in the `memories` table with `type` ∈ `project | preferences | bug | task`, a stable `key`, and a `value`. They are read into the prompt on every turn and re-extracted after each assistant reply.

## Reconstruction notes

- No external webhook subscriptions to re-register.
- No scheduled triggers.
- LLM is metered to the app owner via `sauna.local/v1/llms/responses`.
- ElevenLabs is metered via `sauna.local/v1/elevenlabs/...`.
