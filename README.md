# AdaptQuiz

Upload notes. Quiz to mastery. Questions and grades stay grounded in your notes via RAG.

Stack: Next.js + React + TS + Tailwind. OpenAI API or Ollama (local, free). Chroma. LangChain. SQLite.

## Run

```bash
cd AdaptQuiz
cp .env.example .env
npm install
npm run db:init
npm run dev
```

Open http://localhost:3000. Or click Try demo notes. No upload needed.

## Provider

Default is OpenAI (`OPENAI_API_KEY` in `.env`).

Free path: install Ollama, then:

```bash
ollama serve
ollama pull llama3.1
ollama pull nomic-embed-text
```

Set `LLM_PROVIDER=ollama` in `.env`.

## Chroma

```bash
pip install chromadb
chroma run --path ./chroma-data
```

One collection per session. `CHROMA_URL=http://localhost:8000` in `.env`.

## Checks

```bash
npm run db:init
npm run rag:test
npm run llm:test
npm run scheduler:test
npm run api:test
npm run keys:check
npm run build
```

`rag:test`, `llm:test`, `scheduler:test`, `api:test` need no key. `keys:check` needs a provider.

## How it works

1. Upload PDF, .txt, or pasted text.
2. Pick formats: Multiple Choice, True/False, Short Answer. At least one.
3. Notes split into ~500 token chunks, embedded, stored in Chroma.
4. Concepts extracted and stored in SQLite.
5. Quiz serves one question at a time. Each question uses top-k chunks as context.
6. Scores update per-concept mastery: `0.6 * old + 0.4 * latest`. Streak resets below 0.8.
7. Weak concepts get re-taught, then re-quizzed. Loop ends at full mastery.

Type rule (in `scheduler.ts`, not the LLM): low mastery gets True/False and MCQ. High mastery gets Short Answer. Disabled types fall back to the next enabled one.

Mastered means score >= 0.85 and streak >= 3.

## API

- `POST /api/upload` (file or `{text}`)
- `POST /api/start-session` (`{title?, text?, useDemo?, enabledFormats[]}`)
- `POST /api/next-question` (`{sessionId}`)
- `POST /api/submit-answer` (`{pendingId, userAnswer}`)
- `POST /api/reteach` (`{sessionId, conceptId}`)
- `GET /api/dashboard?sessionId=`

Answer keys stay server side in `pending_questions`. Clients see stems only.

## Data (SQLite)

- `sessions(id, title, enabled_formats, created_at)`
- `concepts(id, session_id, name, source_excerpt, mastery_score, attempts, correct_streak, last_seen)`
- `attempts(id, concept_id, question, question_type, user_answer, score, created_at)`
- `pending_questions(id, session_id, concept_id, payload, created_at)`
