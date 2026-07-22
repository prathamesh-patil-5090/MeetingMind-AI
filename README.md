# MeetingMind AI

Local-first **Meeting Knowledge Engine** — record, transcribe, understand, and search meetings from an Electron desktop app with a NestJS local API.

## Monorepo

```
apps/
  api/        NestJS local backend + Prisma (SQLite) + pipeline workers
  desktop/    Electron + React + Tailwind
packages/
  shared/     Shared TypeScript types
  ai-provider/ AIProvider abstraction (mock, OpenRouter, …)
```

## Phase 1 (this scaffold)

- Electron desktop shell with screen/mic capture
- NestJS API for meetings + file layout under `/meetings/<id>/`
- SQLite schema for the full knowledge model
- Independent pipeline workers (stubs → real Whisper/OCR/vision later)
- `AIProvider` interface so models stay swappable

## Setup

```bash
cp .env.example .env
pnpm install
pnpm --filter @meetingmind/shared build
pnpm --filter @meetingmind/ai-provider build
pnpm db:generate
pnpm db:migrate
```

## Run

```bash
# Terminal 1 — local API
pnpm dev:api

# Terminal 2 — Electron desktop
pnpm dev:desktop
```

API defaults to `http://127.0.0.1:3847`.

Set `AI_PROVIDER=groq` and one or more Groq keys from [console.groq.com](https://console.groq.com):

```env
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3
# or
GROQ_API_KEY=gsk_key1
GROQ_API_KEY_2=gsk_key2
```

Keys are pooled and rotated automatically on rate limits. Defaults:

- Chat/summarize: `qwen/qwen3.6-27b`
- Speech-to-text: `whisper-large-v3-turbo`

Use `AI_PROVIDER=mock` for offline development without a key.

## Storage layout

```
meetings/<meeting-id>/
  recording.mp4
  audio.wav
  transcript.json
  summary.json
  embeddings.json
  metadata.json
  screenshots/
```

## Next increments

1. Persist WebM recordings to `meetings/<id>/` and extract audio with ffmpeg  
2. Wire local Whisper / WhisperX for transcription  
3. Meeting process detection (Meet / Teams / Zoom / …)  
4. OCR + vision workers, vector DB, RAG chat
