// RAG verification over the demo notes (Step 2).
// Run: npm run rag:test
// Uses deterministic hash embeddings — no OPENAI_API_KEY, no Chroma server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  splitNotes,
  ingestNotes,
  retrieveContext,
  toSourceExcerpt,
  OllamaEmbeddings,
  defaultEmbeddings,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from "./rag";

/** Deterministic bag-of-words hash embeddings (test only). */
class HashEmbeddings implements EmbeddingsInterface {
  constructor(private dim = 128) {}
  private vec(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!tok) continue;
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
      v[Math.abs(h) % this.dim] += 1;
    }
    return v;
  }
  embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.vec(t)));
  }
  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(this.vec(text));
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

async function main(): Promise<void> {
  const demo = readFileSync(join(process.cwd(), "data", "demo-notes.txt"), "utf8");
  const emb = new HashEmbeddings();
  const dir = "./chroma-data-test";

  const chunks = await splitNotes(demo);
  console.log(`demo notes: ${demo.length} chars -> ${chunks.length} chunks`);
  console.log(`CHUNK_SIZE=${CHUNK_SIZE} overlap=${CHUNK_OVERLAP}`);
  assert(chunks.length >= 2, "demo notes split into >= 2 chunks");
  assert(
    chunks.every((c) => c.length <= CHUNK_SIZE + 100),
    "all chunks within size budget",
  );

  const ing = await ingestNotes(demo, "demo-test", {
    embeddings: emb,
    backend: "memory",
    chromaDir: dir,
  });
  assert(ing.chunkCount === chunks.length, `ingested ${ing.chunkCount} chunks`);
  assert(ing.isShort === false, "demo notes are NOT short (retrieval active)");

  // Top-k retrieval per concept.
  for (const concept of ["Calvin cycle", "oxidative phosphorylation", "glycolysis"]) {
    const got = await retrieveContext("demo-test", concept, 4, {
      embeddings: emb,
      backend: "memory",
      chromaDir: dir,
    });
    assert(got.length >= 1 && got.length <= 4, `"${concept}" returns 1-4 chunks`);
    const hit = got.some((c) =>
      c.text.toLowerCase().includes(concept.split(" ")[0].toLowerCase().slice(0, 6)),
    );
    assert(hit, `"${concept}" top-k mentions the concept`);
    const m = got[0].metadata;
    assert(
      m.session_id === "demo-test" && m.chunk_index >= 0 && m.char_start >= 0,
      `"${concept}" chunk 0 has source-position metadata ${JSON.stringify(m)}`,
    );
  }

  const rubiscoGot = await retrieveContext("demo-test", "RuBisCO", 4, {
    embeddings: emb,
    backend: "memory",
    chromaDir: dir,
  });
  assert(
    rubiscoGot.some((c) => c.text.toLowerCase().includes("rubisco")),
    "RuBisCO top-k contains the RuBisCO passage",
  );
  const excerpt = toSourceExcerpt(rubiscoGot);
  assert(excerpt.length > 0, `source excerpt grounded: "${excerpt.slice(0, 80)}…"`);

  // Short-text bypass: notes shorter than one chunk.
  const tiny = "Mitochondria make ATP.";
  const tinyIng = await ingestNotes(tiny, "tiny-test", {
    embeddings: emb,
    backend: "memory",
    chromaDir: dir,
  });
  assert(tinyIng.isShort, "tiny notes flagged isShort");
  assert(tinyIng.chunkCount === 1, "tiny notes = 1 chunk");
  const tinyGot = await retrieveContext("tiny-test", "anything at all", 4, {
    embeddings: emb,
    backend: "memory",
    chromaDir: dir,
  });
  assert(
    tinyGot.length === 1 && tinyGot[0].text === tiny,
    "short notes skip retrieval, return full text directly",
  );

  // Persistence: re-read from disk with a fresh call (no re-ingest).
  const again = await retrieveContext("demo-test", "Krebs cycle", 2, {
    embeddings: emb,
    backend: "memory",
    chromaDir: dir,
  });
  assert(again.length === 2, "memory backend persists across calls (k=2)");

  // OllamaEmbeddings with stubbed fetch (no server).
  const okFetch = (url: string): Promise<Response> => {
    assert(url.endsWith("/api/embed"), "ollama embeddings hit /api/embed");
    return Promise.resolve(
      new Response(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }), { status: 200 }),
    );
  };
  const oEmb = new OllamaEmbeddings({ url: "http://x:11434", model: "m", fetchFn: okFetch });
  const vecs = await oEmb.embedDocuments(["a", "b"]);
  assert(vecs.length === 2 && vecs[0][0] === 1, "ollama /api/embed returns batch vectors");
  assert((await oEmb.embedQuery("a"))[0] === 1, "embedQuery works");

  // Legacy fallback: /api/embed 404s → per-prompt /api/embeddings.
  const legacyFetch = (url: string): Promise<Response> => {
    if (url.endsWith("/api/embed")) return Promise.resolve(new Response("no", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify({ embedding: [0.5, 0.5] }), { status: 200 }));
  };
  const lEmb = new OllamaEmbeddings({ fetchFn: legacyFetch });
  const lvecs = await lEmb.embedDocuments(["a", "b"]);
  assert(lvecs.length === 2 && lvecs[0][0] === 0.5, "legacy /api/embeddings fallback works");

  // Total outage → helpful error.
  let threw = false;
  try {
    const dead = new OllamaEmbeddings({ fetchFn: () => Promise.reject(new Error("down")) });
    await dead.embedQuery("x");
  } catch (e) {
    threw = (e as Error).message.includes("ollama pull");
  }
  assert(threw, "ollama down → error hinting 'ollama pull'");

  // defaultEmbeddings follows LLM_PROVIDER.
  process.env.LLM_PROVIDER = "ollama";
  assert(defaultEmbeddings() instanceof OllamaEmbeddings, "LLM_PROVIDER=ollama → local embeddings");
  delete process.env.LLM_PROVIDER;

  console.log(process.exitCode ? "RAG TEST: FAILURES" : "RAG TEST: ALL PASS");
}

void main();
