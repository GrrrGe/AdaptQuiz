import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, requireApiKey } from "@/lib/http";
import { ReteachSchema, getConcept } from "@/lib/store";
import { retrieveContext } from "@/lib/rag";
import { reteach } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/reteach {sessionId, conceptId} — grounded re-teach explanation. */
export async function POST(req: NextRequest) {
  const key = requireApiKey();
  if (key) return key;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON {sessionId, conceptId} required.");
  }
  const parsed = ReteachSchema.safeParse(body);
  if (!parsed.success) return fail(400, "JSON {sessionId, conceptId} required.");
  const { sessionId, conceptId } = parsed.data;

  const db = getDb();
  const concept = getConcept(db, conceptId);
  if (!concept || concept.session_id !== sessionId) {
    return fail(404, "Concept not found in this session.");
  }

  try {
    const chunks = await retrieveContext(sessionId, concept.name, 4);
    if (chunks.length === 0) return fail(500, "No indexed notes for this session.");
    const explanation = await reteach(
      concept.name,
      chunks.map((c) => c.text).join("\n\n"),
    );
    return ok({
      conceptId: concept.id,
      conceptName: concept.name,
      explanation,
      sourceExcerpt: concept.source_excerpt,
    });
  } catch (e) {
    return fail(500, `Re-teach failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
