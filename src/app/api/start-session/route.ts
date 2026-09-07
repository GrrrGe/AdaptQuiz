import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { ok, fail, requireApiKey } from "@/lib/http";
import {
  StartSessionSchema,
  createSession,
  insertConcepts,
  normalizeUploadText,
  loadDemoNotes,
} from "@/lib/store";
import { ingestNotes } from "@/lib/rag";
import { extractConcepts } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/start-session {title?, text?, useDemo?, enabledFormats[]}
 * Creates the session, ingests notes into Chroma (RAG), extracts concepts
 * via the LLM, stores them in SQLite. Returns {sessionId, concepts, isShort}.
 */
export async function POST(req: NextRequest) {
  const key = requireApiKey();
  if (key) return key;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON body required.");
  }
  const parsed = StartSessionSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, `Pick at least one question format. (${parsed.error.issues[0]?.message})`);
  }
  const { title, text, useDemo, enabledFormats } = parsed.data;

  const source = useDemo ? loadDemoNotes() : (text ?? "");
  const norm = normalizeUploadText(source);
  if (!norm.ok) {
    return fail(400, useDemo ? `Demo notes invalid: ${norm.error}` : norm.error);
  }

  const db = getDb();
  const session = createSession(db, title?.trim() || "Untitled session", enabledFormats);

  try {
    const ing = await ingestNotes(norm.text, session.id);
    const concepts = await extractConcepts(norm.text);
    const stored = insertConcepts(db, session.id, concepts);
    return ok({
      sessionId: session.id,
      isShort: ing.isShort,
      chunkCount: ing.chunkCount,
      concepts: stored.map((c) => ({ id: c.id, name: c.name, sourceExcerpt: c.source_excerpt })),
    });
  } catch (e) {
    // Don't orphan a concept-less session on LLM/RAG failure.
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes("Chroma") || msg.includes("ECONNREFUSED")
      ? " Is the local Chroma server running? (chroma run --path ./chroma-data)"
      : "";
    return fail(500, `Session setup failed: ${msg}${hint}`);
  }
}
