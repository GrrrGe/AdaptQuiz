# Codex handoff: continue AdaptQuiz

Repo: https://github.com/GrrrGe/AdaptQuiz (public, branch `main`, clean).
Dir: `AdaptQuiz/`. Prod runs on port 3000 (`npm start`). No remote work needed
unless asked. Commit + push per change, short messages.

## What it is

Adaptive quizzer. User uploads notes, reads a generated study guide, gets
quizzed to full mastery. All questions and grades grounded in user notes via RAG.

Flow: Upload > Learn (guide) > Quiz > Done. Formats: mcq, true_false,
short_answer. Scheduler picks weakest concept first. Mastered at score >= 0.85
and streak >= 3.

## Stack

Next.js 14 App Router + React + TS + Tailwind. SQLite via node:sqlite
(built-in, no native deps). Chroma at port 8000 (server required).
LLM via `LLM_PROVIDER`: `ollama` (local, free) or `openai` (needs key).
Current local models: `qwen2.5:3b` chat, `nomic-embed-text` embeddings.

## Services (already running on this machine)

- Ollama: brew service, port 11434. Models: `qwen2.5:3b`, `nomic-embed-text`.
- Chroma: `uvx --from chromadb chroma` server, port 8000, `--path ./chroma-data`.
- App: `npm run start -p 3000` (production mode, do NOT use `npm run dev` here,
  see gotchas). Logs: `/tmp/adaptquiz-prod.log`, `/tmp/chroma.log`.

## Env (.env, gitignored)

`LLM_PROVIDER=ollama`, `OLLAMA_CHAT_MODEL=qwen2.5:3b`,
`OLLAMA_EMBED_MODEL=nomic-embed-text`, `CHROMA_URL=http://localhost:8000`,
`SQLITE_PATH=./data/adaptquiz.db`. Template: `.env.example`.

## Files

- `src/lib/llm.ts`: ChatFn seam. `extractConcepts` (map-reduce over 24k chars),
  `generateQuestion` (mcq/tf carry `explanation`; ONE repair retry on bad JSON),
  `gradeAnswer` (short answer only), `reteach`, `buildGuide` (one call under
  12k chars, else per-concept). Plain ASCII prompts, no em dashes.
- `src/lib/rag.ts`: split 2000/200 chars. `ingestNotes`, `retrieveContext(k=4)`,
  short-text bypass (`isShort`). `defaultEmbeddings` follows `LLM_PROVIDER`.
  `memory` backend for tests (no server/key).
- `src/lib/scheduler.ts`: pure policy. Bands: <0.4 true_false/easy, <=0.7
  mcq/medium, else short_answer/hard, per-band fallback chains. EMA 0.6/0.4,
  streak cutoff 0.8. Never touch with LLM logic.
- `src/lib/store.ts`: SQLite helpers, zod request schemas, guide cache.
- `src/lib/db.ts`: singleton + `migrate()` (ALTER for old DBs).
- `src/app/api/*/route.ts`: upload, start-session, study-guide, next-question,
  submit-answer, skip-concept, skip-question, reteach, dashboard.
- `src/app/page.tsx`: phase machine + sidebar (spaces in localStorage).
- `src/components/quiz.tsx`: per-type inputs, keyboard (1-4/A-D, T/F,
  Cmd+Enter), skip. `dashboard.tsx`: bars + history.
- Tests: `*.test-run.ts`, run via `npm run <rag|llm|scheduler|api>:test`.
  No key/server needed (fakes + memory backend + :memory: DB).

## Verify before push

```bash
./node_modules/.bin/tsc --noEmit
npm run rag:test && npm run llm:test && npm run scheduler:test && npm run api:test
npm run build
```

Live smoke (Ollama is slow, allow minutes):

```bash
curl -X POST localhost:3000/api/start-session -H 'content-type: application/json' \
  -d '{"title":"s","useDemo":true,"text":null,"enabledFormats":["mcq","true_false"]}'
# save sessionId, then next-question, submit-answer, dashboard
```

Note: tsx scripts do NOT load `.env`. Prefix vars inline, e.g.
`LLM_PROVIDER=ollama OLLAMA_CHAT_MODEL=qwen2.5:3b npm run keys:check`.

## Rules

- No em dashes anywhere user-facing (site, README, errors, prompts). Check:
  `grep -rn "—" src README.md .env.example` must show only code comments,
  test comments, model prompts, and `data/demo-notes.txt` (study content,
  never edit).
- Minimal copy. Short labels. No filler words.
- Answer keys never leave the server (`pending_questions` table). Clients see
  stems only. Keep it that way.
- Adaptive logic stays in `scheduler.ts`. LLM only writes, grades short
  answers, explains. LangChain/Chroma only chunk, embed, retrieve.

## Gotchas (all bitten before)

- Disk nearly full (~1-2GB free). `llama3.1` (4.9GB) does NOT fit. Do not pull
  big models. Safe to delete: `~/Library/Caches/*updater*`, `go-build`.
  Ask before touching browser caches (Dia/Arc ~1.2GB).
- `.next` dev cache corrupts under disk pressure (`Cannot find module
  './276.js'`). Use `npm run build` + `npm start`. If prod breaks, `rm -rf
  .next`, rebuild.
- Small local models drop JSON fields. `generateQuestion` has one repair retry.
  If 500s persist, strengthen prompts before touching schemas.
- `node:sqlite` needs `as unknown as` casts. No `better-sqlite3` (no Node 26
  prebuild). `.npmrc` has `legacy-peer-deps` (LangChain). Chroma + LangChain
  are webpack-external in `next.config.mjs`, keep that list current.
- `StartSessionSchema.text` is `.nullish()`: demo sends `text: null`.
- Shell `$(curl...)` mangles multiline JSON. Save to file, parse with python.

## Backlog (unpicked)

- Guide generation ~1 min on Ollama. Per-concept progress or streaming.
- Question generation 20-40s each. Consider pre-generating a question queue.
- Grading quality of 3B model is noisy. Larger model when disk allows.
- Mobile layout pass. Session list from server instead of localStorage.
- `CODEX_API_KEY_SETUP.md` is stale (Ollama path done). Update or delete.
