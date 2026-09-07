import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, requireApiKey } from "@/lib/http";
import {
  SubmitAnswerSchema,
  getPending,
  deletePending,
  getConcept,
  listConcepts,
  updateConceptRow,
  recordAttempt,
} from "@/lib/store";
import { gradeAnswer } from "@/lib/llm";
import {
  updateMastery,
  isMastered,
  isSessionComplete,
  sessionProgress,
  gradeMcq,
  gradeTrueFalse,
} from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/submit-answer {pendingId, userAnswer}
 * Grades (exact match for mcq/true_false — no LLM call; LLM rubric grade for
 * short_answer), folds the score into mastery, records the attempt, and
 * returns feedback incl. the correct answer + one-line explanation.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON {pendingId, userAnswer} required.");
  }
  const parsed = SubmitAnswerSchema.safeParse(body);
  if (!parsed.success) return fail(400, "JSON {pendingId, userAnswer} required.");
  const { pendingId, userAnswer } = parsed.data;

  const db = getDb();
  const pending = getPending(db, pendingId);
  if (!pending) {
    return fail(410, "Question expired. Get the next one.");
  }
  const concept = getConcept(db, pending.conceptId);
  if (!concept) return fail(404, "Concept not found.");

  const q = pending.question;
  let score: number;
  let explanation: string;
  let correctAnswer: string;
  let rubric: string | undefined;

  if (q.type === "mcq") {
    if (typeof userAnswer !== "number") return fail(400, "MCQ answer must be the chosen option index.");
    score = gradeMcq(q.correctIndex, userAnswer);
    correctAnswer = q.options[q.correctIndex];
    explanation =
      score === 1.0 ? "Correct." : `Correct option: "${correctAnswer}".`;
  } else if (q.type === "true_false") {
    if (typeof userAnswer !== "boolean") return fail(400, "True/false answer must be true or false.");
    score = gradeTrueFalse(q.answer, userAnswer);
    correctAnswer = q.answer ? "True" : "False";
    explanation = score === 1.0 ? "Correct." : `Correct: ${correctAnswer.toLowerCase()}.`;
  } else {
    const key = requireApiKey();
    if (key) return key;
    if (typeof userAnswer !== "string") return fail(400, "Short answer must be text.");
    try {
      const g = await gradeAnswer(q.stem, userAnswer, pending.context, q.rubric);
      score = g.score;
      explanation = g.explanation;
    } catch (e) {
      return fail(500, `Grading failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    correctAnswer = q.expectedAnswer;
    rubric = q.rubric;
  }

  const updated = updateMastery(concept, score);
  updateConceptRow(db, updated);
  recordAttempt(
    db,
    concept.id,
    q.type === "mcq" ? q.stem : q.type === "true_false" ? q.statement : q.stem,
    q.type,
    String(userAnswer),
    score,
  );
  deletePending(db, pendingId);

  const all = listConcepts(db, pending.sessionId);
  const progress = sessionProgress(all);
  return ok({
    score,
    explanation,
    correctAnswer,
    ...(rubric ? { rubric } : {}),
    sourceExcerpt: concept.source_excerpt,
    mastered: isMastered(updated),
    concept: { id: updated.id, name: updated.name, masteryScore: updated.mastery_score },
    progress,
    done: isSessionComplete(all),
  });
}
