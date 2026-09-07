// Key check for AdaptQuiz. Run: npm run keys:check
// OpenAI path: verifies OPENAI_API_KEY (tiny chat + embedding, <$0.001).
// Ollama path (LLM_PROVIDER=ollama): verifies the local server + models,
// no key needed. Also probes Chroma. Exits non-zero with a clear message.
import OpenAI from "openai";

function fail(msg: string): never {
  console.error(`KEYS CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function checkOllama(): Promise<void> {
  const url = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const chatModel = process.env.OLLAMA_CHAT_MODEL ?? "llama3.1";
  const embedModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
  let tags: Response;
  try {
    tags = await fetch(`${url}/api/tags`);
  } catch {
    fail(`Ollama unreachable at ${url} — install from https://ollama.com then run 'ollama serve'.`);
  }
  if (!tags!.ok) fail(`Ollama at ${url} returned ${tags!.status}.`);
  const models = (await tags!.json()) as { models?: { name?: string }[] };
  const names = (models.models ?? []).map((m) => m.name ?? "");
  const has = (want: string) =>
    names.some((n) => n === want || n.startsWith(`${want}:`));
  console.log(`ok: Ollama reachable at ${url} (models: ${names.join(", ") || "none"})`);
  for (const want of [chatModel, embedModel]) {
    if (!has(want)) fail(`Ollama model "${want}" not pulled — run: ollama pull ${want}`);
    console.log(`ok: Ollama model "${want}" present`);
  }
}

async function checkOpenAI(): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) fail("OPENAI_API_KEY is not set. Copy .env.example to .env and add your key — or set LLM_PROVIDER=ollama for the free local path.");
  if (!/^sk-(proj-)?[A-Za-z0-9_-]{20,}$/.test(key!)) {
    fail("OPENAI_API_KEY looks malformed (expected sk-... or sk-proj-...).");
  }
  console.log("ok: OPENAI_API_KEY present and well-formed");

  const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  const embedModel = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
  const client = new OpenAI({ apiKey: key });

  try {
    const chat = await client.chat.completions.create({
      model: chatModel,
      max_tokens: 5,
      messages: [{ role: "user", content: "Reply with the word ok." }],
    });
    console.log(`ok: chat model "${chatModel}" responded ("${chat.choices[0]?.message?.content?.trim()}")`);
  } catch (e) {
    fail(`chat model "${chatModel}" unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const emb = await client.embeddings.create({ model: embedModel, input: "hello" });
    console.log(`ok: embedding model "${embedModel}" returned ${emb.data[0]?.embedding.length} dims`);
  } catch (e) {
    fail(`embedding model "${embedModel}" unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const provider = process.env.LLM_PROVIDER ?? "openai";
  console.log(`provider: ${provider}`);
  if (provider === "ollama") {
    await checkOllama();
  } else if (provider === "openai") {
    await checkOpenAI();
  } else {
    fail(`unknown LLM_PROVIDER: ${provider}`);
  }

  const chromaUrl = process.env.CHROMA_URL ?? "http://localhost:8000";
  let chromaUp = false;
  for (const path of ["/api/v2/heartbeat", "/api/v1/heartbeat"]) {
    try {
      const res = await fetch(`${chromaUrl}${path}`);
      if (res.ok) {
        chromaUp = true;
        break;
      }
    } catch {
      /* try next path */
    }
  }
  if (chromaUp) {
    console.log(`ok: Chroma reachable at ${chromaUrl}`);
  } else {
    console.log(
      `WARN: Chroma not reachable at ${chromaUrl} — start it with: chroma run --path ./chroma-data`,
    );
  }

  console.log("KEYS CHECK: ALL PASS");
}

void main();
