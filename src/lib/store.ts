// Shared store helpers for the API routes (Step 5).
// Thin SQLite access + row mappers + pending-question helpers + upload guard.
// All functions take a Db so tests can pass an :memory: DB.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "./db";
import { newId } from "./db";
import type { Concept, EnabledFormats, QuestionType, Session } from "./types";
import { parseEnabledFormats } from "./types";
import type { Difficulty, Question } from "./llm";
import { QuestionSchema } from "./llm";

/** Reject absurdly large uploads before they hit the LLM. */
export const MAX_UPLOAD_CHARS = 200_000;
/** Reject empty/paste whitespace-only uploads. */
export const MIN_UPLOAD_CHARS = 20;

/** Full question + grading context held server-side between next/submit. */
export const PendingPayloadSchema = z.object({
  sessionId: z.string().min(1),
  conceptId: z.string().min(1),
  conceptName: z.string().min(1),
  question: QuestionSchema,
  context: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
});
export type PendingPayload = z.infer<typeof PendingPayloadSchema>;

// ------------------------------------------------------------ row mappers

interface SessionRow {
  id: string;
  title: string;
  enabled_formats: string;
  created_at: string;
}
interface ConceptRow {
  id: string;
  session_id: string;
  name: string;
  source_excerpt: string;
  mastery_score: number;
  attempts: number;
  correct_streak: number;
  last_seen: string | null;
}

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    enabled_formats: parseEnabledFormats(row.enabled_formats),
    created_at: row.created_at,
  };
}

export function toConcept(row: ConceptRow): Concept {
  return { ...row };
}

// ------------------------------------------------------------ sessions/concepts

export function createSession(db: Db, title: string, enabled: EnabledFormats): Session {
  const id = newId("sess_");
  db.prepare("INSERT INTO sessions(id, title, enabled_formats) VALUES(?, ?, ?)").run(
    id,
    title,
    JSON.stringify(enabled),
  );
  return getSession(db, id)!;
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as SessionRow | undefined;
  return row ? toSession(row) : null;
}

export function insertConcepts(
  db: Db,
  sessionId: string,
  concepts: { name: string; source_excerpt: string }[],
): Concept[] {
  const ins = db.prepare(
    "INSERT INTO concepts(id, session_id, name, source_excerpt) VALUES(?, ?, ?, ?)",
  );
  const out: Concept[] = [];
  for (const c of concepts) {
    const id = newId("con_");
    ins.run(id, sessionId, c.name, c.source_excerpt);
    out.push(getConcept(db, id)!);
  }
  return out;
}

export function getConcept(db: Db, id: string): Concept | null {
  const row = db.prepare("SELECT * FROM concepts WHERE id = ?").get(id) as unknown as ConceptRow | undefined;
  return row ? toConcept(row) : null;
}

export function listConcepts(db: Db, sessionId: string): Concept[] {
  const rows = db
    .prepare("SELECT * FROM concepts WHERE session_id = ? ORDER BY rowid")
    .all(sessionId) as unknown as ConceptRow[];
  return rows.map(toConcept);
}

export function updateConceptRow(db: Db, c: Concept): void {
  db.prepare(
    "UPDATE concepts SET name=?, source_excerpt=?, mastery_score=?, attempts=?, correct_streak=?, last_seen=? WHERE id=?",
  ).run(c.name, c.source_excerpt, c.mastery_score, c.attempts, c.correct_streak, c.last_seen, c.id);
}

// ------------------------------------------------------------ attempts

export function recordAttempt(
  db: Db,
  conceptId: string,
  question: string,
  questionType: QuestionType,
  userAnswer: string,
  score: number,
): void {
  db.prepare(
    "INSERT INTO attempts(id, concept_id, question, question_type, user_answer, score) VALUES(?, ?, ?, ?, ?, ?)",
  ).run(newId("att_"), conceptId, question, questionType, userAnswer, score);
}

export interface AttemptView {
  id: string;
  concept_id: string;
  concept_name: string;
  question: string;
  question_type: QuestionType;
  user_answer: string;
  score: number;
  created_at: string;
}

export function recentAttempts(db: Db, sessionId: string, limit = 20): AttemptView[] {
  return db
    .prepare(
      `SELECT a.id, a.concept_id, c.name AS concept_name, a.question, a.question_type,
              a.user_answer, a.score, a.created_at
         FROM attempts a JOIN concepts c ON c.id = a.concept_id
        WHERE c.session_id = ? ORDER BY a.rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as unknown as AttemptView[];
}

// ------------------------------------------------------------ pending

export function savePending(db: Db, p: PendingPayload): string {
  const id = newId("q_");
  db.prepare("INSERT INTO pending_questions(id, session_id, concept_id, payload) VALUES(?, ?, ?, ?)").run(
    id,
    p.sessionId,
    p.conceptId,
    JSON.stringify(p),
  );
  return id;
}

export function getPending(db: Db, id: string): (PendingPayload & { id: string }) | null {
  const row = db
    .prepare("SELECT payload FROM pending_questions WHERE id = ?")
    .get(id) as unknown as { payload: string } | undefined;
  if (!row) return null;
  return { id, ...PendingPayloadSchema.parse(JSON.parse(row.payload)) };
}

export function deletePending(db: Db, id: string): void {
  db.prepare("DELETE FROM pending_questions WHERE id = ?").run(id);
}

// ------------------------------------------------------------ upload/text guards

/** Validate pasted/extracted text once; routes use this before ingesting. */
export function normalizeUploadText(
  text: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const t = text.trim().replace(/\r\n/g, "\n");
  if (t.length < MIN_UPLOAD_CHARS) {
    return { ok: false, error: `Notes too short. Min ${MIN_UPLOAD_CHARS} characters.` };
  }
  if (t.length > MAX_UPLOAD_CHARS) {
    return {
      ok: false,
      error: `Notes too long. Max ${MAX_UPLOAD_CHARS} characters.`,
    };
  }
  return { ok: true, text: t };
}

/** Seed/demo notes so the app runs without an upload. */
export function loadDemoNotes(): string {
  return readFileSync(join(process.cwd(), "data", "demo-notes.txt"), "utf8").trim();
}

// ------------------------------------------------------------ request schemas

export const StartSessionSchema = z.object({
  title: z.string().max(120).nullish(),
  text: z.string().nullish(),
  useDemo: z.boolean().optional(),
  enabledFormats: z.array(z.enum(["mcq", "true_false", "short_answer"])).min(1),
});

export const NextQuestionSchema = z.object({ sessionId: z.string().min(1) });

export const SubmitAnswerSchema = z.object({
  pendingId: z.string().min(1),
  // mcq → number (chosen index), true_false → boolean, short_answer → string.
  userAnswer: z.union([z.string(), z.number(), z.boolean()]),
});

export const ReteachSchema = z.object({
  sessionId: z.string().min(1),
  conceptId: z.string().min(1),
});

export function difficultyOf(d: Difficulty): Difficulty {
  return d;
}
