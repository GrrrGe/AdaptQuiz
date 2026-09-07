import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { getConcept, updateConceptRow } from "@/lib/store";
import { MASTERY_THRESHOLD, MASTERY_STREAK } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/skip-concept {conceptId} — user already knows it; mark mastered. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON {conceptId} required.");
  }
  const parsed = z.object({ conceptId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return fail(400, "JSON {conceptId} required.");

  const db = getDb();
  const concept = getConcept(db, parsed.data.conceptId);
  if (!concept) return fail(404, "Concept not found.");
  updateConceptRow(db, { ...concept, mastery_score: MASTERY_THRESHOLD, correct_streak: MASTERY_STREAK });
  return ok({ skipped: true, conceptId: concept.id });
}
