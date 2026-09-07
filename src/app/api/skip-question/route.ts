import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { getPending, deletePending, getConcept, updateConceptRow } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/skip-question {pendingId} — drop this question with no score
 * change; touch last_seen so the scheduler serves another concept next.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON {pendingId} required.");
  }
  const parsed = z.object({ pendingId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return fail(400, "JSON {pendingId} required.");

  const db = getDb();
  const pending = getPending(db, parsed.data.pendingId);
  if (!pending) return fail(410, "Question expired. Get the next one.");
  const concept = getConcept(db, pending.conceptId);
  if (concept) {
    updateConceptRow(db, { ...concept, last_seen: new Date().toISOString() });
  }
  deletePending(db, pending.id);
  return ok({ skipped: true });
}
