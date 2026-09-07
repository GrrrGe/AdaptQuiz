import { NextRequest } from "next/server";
import pdfParse from "pdf-parse";
import { ok, fail } from "@/lib/http";
import { normalizeUploadText, MAX_UPLOAD_CHARS } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/upload — lecture notes in, plain text out.
 * Accepts multipart {file: PDF|.txt} OR JSON {text} (pasted notes).
 * Returns {text, chars}. Does NOT create a session (see start-session).
 */
export async function POST(req: NextRequest) {
  const ctype = req.headers.get("content-type") ?? "";

  let raw = "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "multipart field 'file' is required.");
    if (file.size > MAX_FILE_BYTES) return fail(400, "File too large. Max 10 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".pdf")) {
        raw = (await pdfParse(buf)).text ?? "";
      } else {
        raw = buf.toString("utf8");
      }
    } catch {
      return fail(400, "Could not read file.");
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(400, "Send multipart {file} or JSON {text}.");
    }
    const text = (body as { text?: unknown })?.text;
    if (typeof text !== "string") return fail(400, "JSON {text: string} is required.");
    raw = text;
  }

  const norm = normalizeUploadText(raw);
  if (!norm.ok) return fail(400, norm.error);
  return ok({ text: norm.text, chars: norm.text.length, maxChars: MAX_UPLOAD_CHARS });
}
