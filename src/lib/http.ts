import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Guard for routes needing the LLM/embeddings backend. Ollama (local, free)
 * needs no key — only the OpenAI provider requires OPENAI_API_KEY.
 */
export function requireApiKey(): NextResponse | null {
  if ((process.env.LLM_PROVIDER ?? "openai") === "ollama") return null;
  if (!process.env.OPENAI_API_KEY) {
    return fail(500, "OPENAI_API_KEY not set. Add it to .env or set LLM_PROVIDER=ollama.");
  }
  return null;
}
