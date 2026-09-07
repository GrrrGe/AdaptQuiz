// Adaptive scheduler for AdaptQuiz (Step 4).
//
// This is MY code, not the LLM's and not LangChain's: every study decision —
// what to quiz, in what format, and when to stop — is a deterministic rule
// here. The LLM only writes questions/grades/explanations; retrieval only
// fetches context. Pure functions (no DB, no network) so the policy is
// testable: `npm run scheduler:test`.

import type { Concept, EnabledFormats, QuestionType } from "./types";
import { MASTERY_THRESHOLD, MASTERY_STREAK } from "./types";
import type { Difficulty } from "./llm";

/** Score ≥ this counts as "correct" (streak++, feeds updateMastery). */
export const CORRECT_CUTOFF = 0.8;

/** Mastery bands driving the type↔difficulty coupling. */
const LOW_BAND = 0.4;
const HIGH_BAND = 0.7;

// ------------------------------------------------------------ mastered?

/** A concept is mastered when score ≥ 0.85 AND correct streak ≥ 3. */
export function isMastered(c: Concept): boolean {
  return c.mastery_score >= MASTERY_THRESHOLD && c.correct_streak >= MASTERY_STREAK;
}

/** Session is complete when there is ≥1 concept and all are mastered. */
export function isSessionComplete(concepts: Concept[]): boolean {
  return concepts.length > 0 && concepts.every(isMastered);
}

/** Dashboard progress: counts + % mastered. */
export function sessionProgress(concepts: Concept[]): {
  mastered: number;
  total: number;
  percent: number;
} {
  const mastered = concepts.filter(isMastered).length;
  const total = concepts.length;
  return { mastered, total, percent: total === 0 ? 0 : (mastered / total) * 100 };
}

// ------------------------------------------------------------ next concept

/**
 * Which concept to quiz next: among UNMASTERED concepts, lowest
 * mastery_score first; ties broken by longest time since last_seen
 * (never-seen, last_seen=null, counts as oldest). Returns null when
 * everything is mastered (or the list is empty) — the caller then shows
 * the dashboard instead of another question. Mastered concepts are never
 * re-quizzed, so post-quiz loops automatically target only weak concepts.
 */
export function pickNextConcept(concepts: Concept[]): Concept | null {
  const weak = concepts.filter((c) => !isMastered(c));
  if (weak.length === 0) return null;
  return weak.sort((a, b) => {
    if (a.mastery_score !== b.mastery_score) return a.mastery_score - b.mastery_score;
    const ta = a.last_seen ? Date.parse(a.last_seen) : 0;
    const tb = b.last_seen ? Date.parse(b.last_seen) : 0;
    return ta - tb;
  })[0];
}

// ------------------------------------------------------------ type + difficulty

/**
 * What format + difficulty to serve for a concept, from the session's
 * enabled formats. Coupling rule (fast recall → deep recall as mastery
 * climbs):
 *
 *   mastery < 0.4  → prefer true_false, difficulty easy
 *   0.4 – 0.7      → prefer mcq,         difficulty medium
 *   mastery > 0.7  → prefer short_answer, difficulty hard
 *
 * If the preferred type isn't enabled, fall back down the same ladder
 * (cheapest recall first): the first enabled type in
 * [true_false, mcq, short_answer] order relative to the band — i.e. each
 * band has a fallback chain starting at its preference and wrapping toward
 * cheaper formats. Concretely:
 *   easy band:   true_false → mcq → short_answer
 *   medium band: mcq → true_false → short_answer
 *   hard band:   short_answer → mcq → true_false
 * Throws when enabledFormats is empty (sessions must enable ≥1 format).
 */
export function pickTypeAndDifficulty(
  concept: Concept,
  enabledFormats: EnabledFormats,
): { type: QuestionType; difficulty: Difficulty } {
  if (enabledFormats.length === 0) {
    throw new Error("at least one question format must be enabled");
  }
  const set = new Set(enabledFormats);
  const chains: Record<Difficulty, QuestionType[]> = {
    easy: ["true_false", "mcq", "short_answer"],
    medium: ["mcq", "true_false", "short_answer"],
    hard: ["short_answer", "mcq", "true_false"],
  };
  const difficulty: Difficulty =
    concept.mastery_score < LOW_BAND
      ? "easy"
      : concept.mastery_score <= HIGH_BAND
        ? "medium"
        : "hard";
  const type = chains[difficulty].find((t) => set.has(t));
  if (!type) throw new Error("at least one question format must be enabled");
  return { type, difficulty };
}

// ------------------------------------------------------------ mastery update

/**
 * Fold one graded result into a concept. Exact-match scores (mcq /
 * true_false: 1.0 or 0.0) and LLM short-answer scores (0.0–1.0) feed this
 * identically:
 *   new_score = 0.6 * old_score + 0.4 * latest_result
 * Score ≥ 0.8 extends correct_streak, anything less resets it to 0.
 * attempts++ and last_seen=now on every update. Pure: returns a new object.
 */
export function updateMastery(
  concept: Concept,
  result: number,
  now: string = new Date().toISOString(),
): Concept {
  if (!(result >= 0 && result <= 1)) {
    throw new Error(`result out of range: ${result}`);
  }
  const mastery_score = 0.6 * concept.mastery_score + 0.4 * result;
  return {
    ...concept,
    mastery_score,
    attempts: concept.attempts + 1,
    correct_streak: result >= CORRECT_CUTOFF ? concept.correct_streak + 1 : 0,
    last_seen: now,
  };
}

// ------------------------------------------------------------ exact grading

/**
 * Deterministic grading for closed formats — no LLM call.
 * MCQ: chosen index === correctIndex → 1.0 else 0.0.
 * True/false: chosen === answer → 1.0 else 0.0.
 */
export function gradeMcq(correctIndex: number, chosenIndex: number): number {
  return chosenIndex === correctIndex ? 1.0 : 0.0;
}

export function gradeTrueFalse(answer: boolean, chosen: boolean): number {
  return chosen === answer ? 1.0 : 0.0;
}
