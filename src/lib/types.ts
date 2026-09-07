// Shared domain types for AdaptQuiz (Step 1).
// The adaptive logic lives in scheduler.ts (Step 4) — these are just shapes.

export const QUESTION_TYPES = ["mcq", "true_false", "short_answer"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type EnabledFormats = QuestionType[];

export interface Session {
  id: string;
  title: string;
  enabled_formats: EnabledFormats;
  created_at: string;
}

export interface Concept {
  id: string;
  session_id: string;
  name: string;
  source_excerpt: string;
  /** 0.0–1.0, updated by scheduler.updateMastery (Step 4). */
  mastery_score: number;
  attempts: number;
  correct_streak: number;
  /** ISO-8601 UTC or null if never quizzed. */
  last_seen: string | null;
}

export interface Attempt {
  id: string;
  concept_id: string;
  question: string;
  question_type: QuestionType;
  user_answer: string;
  /** 0.0–1.0 (exact match or LLM grade — scheduler treats both identically). */
  score: number;
  created_at: string;
}

/** Mastery rule (implemented in Step 4): score >= 0.85 AND streak >= 3. */
export const MASTERY_THRESHOLD = 0.85;
export const MASTERY_STREAK = 3;

export function isEnabledFormat(v: unknown): v is QuestionType {
  return (
    v === "mcq" || v === "true_false" || v === "short_answer"
  );
}

export function parseEnabledFormats(json: string): EnabledFormats {
  const arr: unknown = JSON.parse(json);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("enabled_formats must be a non-empty array");
  }
  for (const v of arr) {
    if (!isEnabledFormat(v)) throw new Error(`unknown format: ${String(v)}`);
  }
  return arr as EnabledFormats;
}
