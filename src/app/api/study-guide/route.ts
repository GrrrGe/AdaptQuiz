import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ok, fail, requireApiKey } from "@/lib/http";
import {
  getSession,
  getSessionText,
  listConcepts,
  saveGuide,
  getGuides,
} from "@/lib/store";
import { retrieveContext } from "@/lib/rag";
import { buildGuide } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/study-guide {sessionId}
 * Teach-first guide: one summary + key points per concept. Generated once,
 * cached in concept_guides, instant on revisit.
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
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return fail(400, "JSON {sessionId} required.");
  const { sessionId } = parsed.data;

  const db = getDb();
  const session = getSession(db, sessionId);
  if (!session) return fail(404, "Session not found.");
  const concepts = listConcepts(db, sessionId);
  if (concepts.length === 0) return fail(400, "No concepts in this session.");

  const cached = getGuides(db, sessionId);
  if (cached.length > 0 && cached.every((g) => g.summary)) return ok({ guides: cached });

  try {
    const fullText = getSessionText(db, sessionId);
    const contextFor = async (name: string): Promise<string> => {
      const chunks = await retrieveContext(sessionId, name, 4);
      return chunks.map((c) => c.text).join("\n\n") || fullText;
    };
    const items = await buildGuide(fullText, concepts.map((c) => c.name), contextFor);
    const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
    for (const c of concepts) {
      let item = byName.get(c.name.toLowerCase());
      if (!item) {
        // LLM renamed or dropped it: per-concept fallback over retrieved context.
        const retry = await buildGuide("", [c.name], contextFor);
        item = retry.find((r) => r.name.toLowerCase() === c.name.toLowerCase()) ?? retry[0];
      }
      if (item) saveGuide(db, c.id, item.summary, item.keyPoints);
    }
    return ok({ guides: getGuides(db, sessionId) });
  } catch (e) {
    return fail(500, `Guide failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
