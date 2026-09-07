-- AdaptQuiz SQLite schema (Step 1)
-- Sessions own concepts; concepts own attempts. FKs enforced via PRAGMA.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- JSON array of enabled formats, subset of ["mcq","true_false","short_answer"], min length 1.
  enabled_formats TEXT NOT NULL,
  -- Full notes text (powers the one-shot study guide; added by migration on old DBs).
  source_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Verbatim excerpt from the notes grounding this concept (shown in UI).
  source_excerpt TEXT NOT NULL DEFAULT '',
  mastery_score REAL NOT NULL DEFAULT 0.0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  -- ISO-8601 UTC; NULL until first served. Scheduler uses it for recency.
  last_seen TEXT
);

CREATE INDEX IF NOT EXISTS idx_concepts_session ON concepts(session_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  -- The question stem/statement served (JSON-encoded for MCQ options etc. in later steps).
  question TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq','true_false','short_answer')),
  user_answer TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_concept ON attempts(concept_id);

-- In-flight questions: answer key + grading context for a served but
-- unanswered question. Deleted on submit. (Step 5; IF NOT EXISTS migrates
-- existing DBs because db.ts re-runs this file on every open.)
CREATE TABLE IF NOT EXISTS pending_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  -- JSON PendingPayload (full question incl. answer key + grading context).
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Teach-first study guide: one cached summary + key points per concept,
-- generated once per session so the guide screen is instant on revisit.
CREATE TABLE IF NOT EXISTS concept_guides (
  concept_id TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_points TEXT NOT NULL
);
