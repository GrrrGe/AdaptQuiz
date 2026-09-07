import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, requireApiKey } from "@/lib/http";
import {
  NextQuestionSchema,
  getSession,
  listConcepts,
  savePending,
} from "@/lib/store";
import { retrieveContext } from "@/lib/rag";
import { generateQuestion } from "@/lib/llm";
import {
  pickNextConcept,
  pickTypeAndDifficulty,
  isSessionComplete,
  sessionProgress,
} from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/next-question {sessionId}
 * Scheduler picks the concept + type/difficulty; RAG grounds the question;
 * LLM renders it. Answer keys stay server-side in pending_questions —
 * the client only sees the public stem/options.
 */
export async function POST(req: NextRequest) {
  const key = requireApiKey();
  if (key) return key;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON {sessionId} required.");
  }
  const parsed = NextQuestionSchema.safeParse(body);
  if (!parsed.success) return fail(400, "JSON {sessionId} required.");
  const { sessionId } = parsed.data;

  const db = getDb();
  const session = getSession(db, sessionId);
  if (!session) return fail(404, "Session not found.");
  const concepts = listConcepts(db, sessionId);
  const progress = sessionProgress(concepts);
  if (isSessionComplete(concepts)) return ok({ done: true, progress });

  const concept = pickNextConcept(concepts);
  if (!concept) return ok({ done: true, progress });

  let type: ReturnType<typeof pickTypeAndDifficulty>;
  try {
    type = pickTypeAndDifficulty(concept, session.enabled_formats);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "No formats enabled.");
  }

  try {
    const chunks = await retrieveContext(sessionId, concept.name, 4);
    if (chunks.length === 0) {
      return fail(500, "No indexed notes for this session.");
    }
    const context = chunks.map((c) => c.text).join("\n\n");
    const question = await generateQuestion(concept.name, context, type.type, type.difficulty);

    const pendingId = savePending(db, {
      sessionId,
      conceptId: concept.id,
      conceptName: concept.name,
      question,
      context,
      difficulty: type.difficulty,
    });

    const pub =
      question.type === "mcq"
        ? { stem: question.stem, options: question.options }
        : question.type === "true_false"
          ? { statement: question.statement }
          : { stem: question.stem };
    return ok({
      done: false,
      pendingId,
      conceptId: concept.id,
      conceptName: concept.name,
      sourceExcerpt: concept.source_excerpt,
      questionType: question.type,
      difficulty: type.difficulty,
      question: pub,
      progress,
    });
  } catch (e) {
    return fail(500, `Question generation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
