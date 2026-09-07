# Handoff for Codex — wire up a provider for AdaptQuiz

> Paste this whole file to Codex. The user chose the FREE path (Ollama), so
> Section A applies. Section B (OpenAI key) is the fallback if Ollama is
> unavailable. Codex must never print or commit secrets.

## A. Ollama path (chosen — free, local, no key)

Tasks for Codex, in order:
1. `cd AdaptQuiz` and set `LLM_PROVIDER=ollama` in `.env`
   (copy from `.env.example` first if `.env` is missing).
2. Install Ollama from https://ollama.com if absent; `ollama serve`
   (background), `ollama pull llama3.1`, `ollama pull nomic-embed-text`.
3. `npm install` (if needed), then `npm run keys:check` — must end with
   `KEYS CHECK: ALL PASS`. A Chroma WARN is acceptable (see step 4).
4. Start Chroma if needed (`pip install chromadb && (chroma run --path ./chroma-data &)`),
   re-run `keys:check` until Chroma shows `ok`.
5. Live smoke per the steps in Section C below.
6. Report: keys:check output, concepts extracted, sample question + score.

## B. OpenAI path (fallback — only if the user provides a key)

- **Only ONE secret is required: `OPENAI_API_KEY`.**
  It powers both the chat model (`gpt-4o-mini`) and embeddings
  (`text-embedding-3-small`). There is no second key — Chroma runs locally
  and needs no key; SQLite needs no key.
- Optional vars already defaulted in `.env.example`: `LLM_PROVIDER=openai`,
  `OPENAI_CHAT_MODEL`, `OPENAI_EMBED_MODEL`, `CHROMA_URL`, `CHROMA_DIR`,
  `SQLITE_PATH`. Don't change them unless asked.
- The key itself: create one at https://platform.openai.com/api-keys
  (a restricted key with only "Model capabilities: read/write" is enough;
  no admin/org permissions needed). Expected spend for setup + one demo
  session: well under $0.10.

## 2. The key (user fills this in — Codex: read, don't print)

```env
OPENAI_API_KEY=PASTE_KEY_HERE
```

## 3. Tasks for Codex — OpenAI path only (in order, stop and report on first failure)

1. `cd AdaptQuiz && cp -n .env.example .env` (don't overwrite an existing `.env`).
2. Put the key from section 2 into `.env` as `OPENAI_API_KEY=...`.
   Never `echo` the key to the terminal, never log it, never commit `.env`
   (it is already in `.gitignore` — verify that with `git check-ignore .env`).
3. `npm install` (if `node_modules` is missing).
4. `npm run keys:check` — must end with `KEYS CHECK: ALL PASS`.
   A Chroma WARN is acceptable (step 5 covers it); anything else is a failure.
5. Start Chroma if needed: `pip install chromadb && (chroma run --path ./chroma-data &)`
   then re-run `npm run keys:check` until Chroma shows `ok`.
## C. Live smoke (both paths — proves the full loop works)

   - `npm run db:init`
   - `npm run dev -- -p 3109` in the background
   - `curl -X POST localhost:3109/api/start-session -H 'content-type: application/json' -d '{"title":"smoke","useDemo":true,"enabledFormats":["mcq","true_false","short_answer"]}'`
     → must return a `sessionId` and ≥3 concepts. Save the sessionId.
   - `curl -X POST localhost:3109/api/next-question -H 'content-type: application/json' -d '{"sessionId":"<id>"}'`
     → must return `done:false` plus a question with NO answer key
     (no `correctIndex`/`answer`/`expectedAnswer` fields anywhere).
   - Answer it per its type (`userAnswer`: option index number for mcq,
     boolean for true_false, string for short_answer):
     `curl -X POST localhost:3109/api/submit-answer -H 'content-type: application/json' -d '{"pendingId":"<id>","userAnswer":0}'`
     → must return a `score` 0–1 and an `explanation`.
   - `curl 'localhost:3109/api/dashboard?sessionId=<id>'` → must show concepts
     with `masteryScore > 0` on the answered one.
   - Stop the dev server.
7. Report back: keys:check output, number of concepts extracted from the
   demo notes, the sample question + score from the smoke test, and total
   approximate spend if visible (n/a for Ollama).

## 4. Hard rules for Codex

- The key goes ONLY in `.env` (local file). Never in code, never in git,
  never in chat output, never in screenshots.
- Do not rotate/regenerate the key, do not create new keys, do not touch
  billing or organization settings.
- Do not change model names or app code to "make it work" — if a model call
  fails, report the exact error instead.
- If `keys:check` says the key is malformed or rejected (401), stop and ask
  the user for a fresh key — don't retry more than twice.
