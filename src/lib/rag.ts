// RAG plumbing for AdaptQuiz (Step 2).
//
// Responsibilities (only these — adaptive logic lives in scheduler.ts):
//   - split notes into ~500-token chunks with ~50-token overlap (LangChain)
//   - embed chunks (OpenAI text-embedding-3-small, or local Ollama when
//     LLM_PROVIDER=ollama — free, no key)
//   - store in Chroma (local persistent server: `chroma run --path ./chroma-data`)
//   - retrieveContext(conceptName, k): top-k chunks by cosine similarity
//   - short-text bypass: notes shorter than one chunk skip vector retrieval;
//     retrieveContext returns the full text directly.
//
// A file-backed `memory` backend (brute-force cosine, persisted as JSON under
// CHROMA_DIR) mirrors the Chroma path so tests/demos run with no API key and
// no Chroma server. Inject any EmbeddingsInterface via RagOptions.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient, type IEmbeddingFunction } from "chromadb";

// ~500 tokens ≈ 2000 chars; ~50 tokens ≈ 200 chars (roughly 4 chars/token).
export const CHUNK_SIZE = 2000;
export const CHUNK_OVERLAP = 200;

export interface ChunkMeta {
  session_id: string;
  chunk_index: number;
  char_start: number;
  char_end: number;
}

export interface RetrievedChunk {
  text: string;
  metadata: ChunkMeta;
}

export interface IngestResult {
  collection: string;
  chunkCount: number;
  /** True when notes fit in a single chunk — callers pass full text directly. */
  isShort: boolean;
  fullText: string;
}

export interface RagOptions {
  embeddings?: EmbeddingsInterface;
  /** 'chroma' (default) or 'memory' file-backed fallback. */
  backend?: "chroma" | "memory";
  chromaUrl?: string;
  chromaDir?: string;
}

export function collectionName(sessionId: string): string {
  return `adaptquiz-${sessionId}`;
}

/**
 * Default embeddings follow LLM_PROVIDER: "ollama" → local Ollama model
 * (free, no key), anything else → OpenAI text-embedding-3-small.
 */
export function defaultEmbeddings(): EmbeddingsInterface {
  if ((process.env.LLM_PROVIDER ?? "openai") === "ollama") return new OllamaEmbeddings();
  return new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small",
  });
}

/** Ollama embedding model — pull first: `ollama pull nomic-embed-text`. */
export function ollamaEmbedModel(): string {
  return process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Local embeddings via Ollama (free, no API key). Tries the current
 * /api/embed endpoint, falls back to legacy /api/embeddings. fetchFn is
 * injectable for tests.
 */
export class OllamaEmbeddings implements EmbeddingsInterface {
  caller?: unknown;
  constructor(
    private opts: { url?: string; model?: string; fetchFn?: FetchFn } = {},
  ) {}

  private get url(): string {
    return this.opts.url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  }
  private get model(): string {
    return this.opts.model ?? ollamaEmbedModel();
  }
  private get doFetch(): FetchFn {
    return this.opts.fetchFn ?? ((u, i) => fetch(u, i));
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Current API: one call, {embeddings: number[][]}.
    try {
      const res = await this.doFetch(`${this.url}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { embeddings?: number[][] };
      if (!body.embeddings) throw new Error("no embeddings in response");
      return body.embeddings;
    } catch (e) {
      // Legacy API: one call per prompt, {embedding: number[]}.
      try {
        const out: number[][] = [];
        for (const prompt of texts) {
          const res = await this.doFetch(`${this.url}/api/embeddings`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: this.model, prompt }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const body = (await res.json()) as { embedding?: number[] };
          if (!body.embedding) throw new Error("no embedding in response");
          out.push(body.embedding);
        }
        return out;
      } catch {
        throw new Error(
          `Ollama embeddings unreachable at ${this.url}. Run 'ollama serve' and: ollama pull ${this.model} (first error: ${e instanceof Error ? e.message : String(e)})`,
        );
      }
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0];
  }
}

/** Split notes with LangChain. Returns chunk texts in order. */
export async function splitNotes(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  return splitter.splitText(text);
}

function opts(o: RagOptions = {}): Required<RagOptions> {
  return {
    embeddings: o.embeddings ?? defaultEmbeddings(),
    backend: o.backend ?? "chroma",
    chromaUrl: o.chromaUrl ?? process.env.CHROMA_URL ?? "http://localhost:8000",
    chromaDir: o.chromaDir ?? process.env.CHROMA_DIR ?? "./chroma-data",
  };
}

function memoryPath(sessionId: string, dir: string): string {
  return join(dir, `memory-${sessionId}.json`);
}

interface MemoryEntry {
  text: string;
  metadata: ChunkMeta;
  vector: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Ingest notes for a session: split → embed → store in Chroma collection
 * `adaptquiz-<sessionId>` (one collection per session isolates retrieval).
 * Chunk metadata carries the source position for UI source excerpts.
 */
export async function ingestNotes(
  text: string,
  sessionId: string,
  o: RagOptions = {},
): Promise<IngestResult> {
  const { embeddings, backend, chromaUrl, chromaDir } = opts(o);
  const chunks = await splitNotes(text);
  const isShort = chunks.length <= 1;

  const metadatas: ChunkMeta[] = chunks.map((_, i) => ({
    session_id: sessionId,
    chunk_index: i,
    // Approximate source positions (splitter doesn't expose offsets).
    char_start: -1,
    char_end: -1,
  }));
  // Fill approximate char offsets by locating each chunk in the source text.
  let cursor = 0;
  chunks.forEach((c, i) => {
    const probe = c.slice(0, 60);
    const at = text.indexOf(probe, cursor);
    if (at >= 0) {
      metadatas[i].char_start = at;
      metadatas[i].char_end = at + c.length;
      cursor = at + 1;
    }
  });

  if (backend === "memory") {
    mkdirSync(chromaDir, { recursive: true });
    const vectors = await embeddings.embedDocuments(chunks);
    const entries: MemoryEntry[] = chunks.map((t, i) => ({
      text: t,
      metadata: metadatas[i],
      vector: vectors[i],
    }));
    writeFileSync(memoryPath(sessionId, chromaDir), JSON.stringify(entries));
  } else {
    const store = new Chroma(embeddings, {
      collectionName: collectionName(sessionId),
      url: chromaUrl,
    });
    await store.addDocuments(
      chunks.map((pageContent, i) => ({
        pageContent,
        metadata: metadatas[i] as unknown as Record<string, string | number>,
      })),
    );
  }

  return { collection: collectionName(sessionId), chunkCount: chunks.length, isShort, fullText: text };
}

/**
 * Top-k chunks for a concept by cosine similarity (Chroma query / memory scan).
 * Short sessions (≤1 chunk) skip vector retrieval and return the full text.
 */
export async function retrieveContext(
  sessionId: string,
  conceptName: string,
  k = 4,
  o: RagOptions = {},
): Promise<RetrievedChunk[]> {
  const { embeddings, backend, chromaUrl, chromaDir } = opts(o);

  if (backend === "memory") {
    const p = memoryPath(sessionId, chromaDir);
    if (!existsSync(p)) return [];
    const entries = JSON.parse(readFileSync(p, "utf8")) as MemoryEntry[];
    if (entries.length <= 1) {
      // Short-text bypass: no embedding query, return full text directly.
      return entries.map(({ text, metadata }) => ({ text, metadata }));
    }
    const q = await embeddings.embedQuery(conceptName);
    return entries
      .map((e) => ({ e, s: cosine(q, e.vector) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map(({ e }) => ({ text: e.text, metadata: e.metadata }));
  }

  const client = new ChromaClient({ path: chromaUrl });
  // No-op EF: this handle only uses count()/get() (no vector query), so
  // generate() is never called. Similarity search goes via LangChain below.
  const noopEF: IEmbeddingFunction = {
    generate: (_texts: string[]) => Promise.resolve([]),
  };
  const col = await client.getCollection({ name: collectionName(sessionId), embeddingFunction: noopEF });
  const count = await col.count();
  if (count <= 1) {
    // Short-text bypass: fetch the single doc, no similarity query.
    const got = await col.get({ limit: 1 });
    const docs = (got.documents ?? []).filter((d): d is string => d != null);
    const metas = (got.metadatas ?? []) as unknown as ChunkMeta[];
    return docs.map((text, i) => ({ text, metadata: metas[i] }));
  }

  const store = new Chroma(embeddings, {
    collectionName: collectionName(sessionId),
    url: chromaUrl,
  });
  const docs = await store.similaritySearch(conceptName, k);
  return docs.map((d) => ({
    text: d.pageContent,
    metadata: d.metadata as unknown as ChunkMeta,
  }));
}

/** Concept excerpt helper: first retrieved chunk's text, truncated for the UI. */
export function toSourceExcerpt(chunks: RetrievedChunk[], maxLen = 280): string {
  if (chunks.length === 0) return "";
  const t = chunks[0].text.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1) + "…" : t;
}
