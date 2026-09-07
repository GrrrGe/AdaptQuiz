import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { getSession, listConcepts, recentAttempts } from "@/lib/store";
import { isMastered, sessionProgress } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/dashboard?sessionId= — per-concept mastery + overall % + history. */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return fail(400, "Missing ?sessionId=.");

  const db = getDb();
  const session = getSession(db, sessionId);
  if (!session) return fail(404, "Session not found.");
  const concepts = listConcepts(db, sessionId);

  return ok({
    session: {
      id: session.id,
      title: session.title,
      enabledFormats: session.enabled_formats,
      createdAt: session.created_at,
    },
    concepts: concepts.map((c) => ({
      id: c.id,
      name: c.name,
      sourceExcerpt: c.source_excerpt,
      masteryScore: c.mastery_score,
      attempts: c.attempts,
      correctStreak: c.correct_streak,
      lastSeen: c.last_seen,
      mastered: isMastered(c),
    })),
    progress: sessionProgress(concepts),
    recentAttempts: recentAttempts(db, sessionId),
  });
}
