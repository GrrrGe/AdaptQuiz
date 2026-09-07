// LLM wrapper verification (Step 3). Run: npm run llm:test
// Fake ChatFn — no OPENAI_API_KEY needed. Also asserts prompts carry grounding.
import {
  extractConcepts,
  generateQuestion,
  gradeAnswer,
  reteach,
  providerChatFn,
  ollamaChatFn,
  LlmError,
  EXTRACT_SINGLE_BUDGET,
  type ChatFn,
} from "./llm";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const seen: { system: string; user: string }[] = [];
const CONCEPTS_JSON = JSON.stringify({
  concepts: [
    { name: "Light-dependent reactions", source_excerpt: "Chlorophyll absorbs photons..." },
    { name: "Calvin cycle", source_excerpt: "RuBisCO attaches CO2..." },
  ],
});

async function main(): Promise<void> {
  // --- extractConcepts (single path) ---
  seen.length = 0;
  const fakeSingle: ChatFn = (system, user) => {
    seen.push({ system, user });
    return Promise.resolve(CONCEPTS_JSON);
  };
  const concepts = await extractConcepts("some lecture notes", fakeSingle);
  assert(concepts.length === 2, "extractConcepts returns 2 concepts");
  assert(concepts[0].name === "Light-dependent reactions", "concept name parsed");
  assert(
    seen[0].user.includes("some lecture notes"),
    "extraction prompt carries the full notes",
  );

  // --- extractConcepts (map-reduce path) ---
  let calls = 0;
  const fakeMap: ChatFn = (system, user) => {
    calls++;
    seen.push({ system, user });
    if (user.startsWith("CANDIDATE CONCEPTS:")) return Promise.resolve(CONCEPTS_JSON);
    return Promise.resolve(
      JSON.stringify({ concepts: [{ name: `Part concept`, source_excerpt: "quote" }] }),
    );
  };
  const longText = "x".repeat(EXTRACT_SINGLE_BUDGET + 100);
  const merged = await extractConcepts(longText, fakeMap);
  assert(calls >= 3, `long notes use map-reduce (${calls} calls: map + reduce)`);
  assert(merged.length === 2, "reduce step dedupes to final list");

  // --- generateQuestion: all three types ---
  const ctx = "RuBisCO attaches CO2 to RuBP in the stroma.";
  const mcqFake: ChatFn = (system, user) => {
    seen.push({ system, user });
    return Promise.resolve(
      JSON.stringify({
        type: "mcq",
        stem: "Where does RuBisCO act?",
        options: ["Stroma", "Thylakoid", "Matrix", "Cytoplasm"],
        correctIndex: 0,
      }),
    );
  };
  const mcq = await generateQuestion("Calvin cycle", ctx, "mcq", "easy", mcqFake);
  assert(mcq.type === "mcq", "mcq parses with 4 options + index");
  if (mcq.type === "mcq") {
    assert(mcq.options.length === 4 && mcq.correctIndex === 0, "mcq options/index valid");
  }
  assert(seen[seen.length - 1].user.includes(ctx), "question prompt carries context");
  assert(seen[seen.length - 1].user.includes("Calvin cycle"), "question prompt names concept");

  const tf = await generateQuestion("Calvin cycle", ctx, "true_false", "easy", () =>
    Promise.resolve(
      JSON.stringify({ type: "true_false", statement: "RuBisCO acts in the stroma.", answer: true }),
    ),
  );
  assert(tf.type === "true_false" && tf.answer === true, "true_false parses");

  const sa = await generateQuestion("Calvin cycle", ctx, "short_answer", "hard", () =>
    Promise.resolve(
      JSON.stringify({
        type: "short_answer",
        stem: "Explain carbon fixation.",
        rubric: "Mentions RuBisCO; mentions CO2 + RuBP.",
        expectedAnswer: "RuBisCO attaches CO2 to RuBP.",
      }),
    ),
  );
  assert(sa.type === "short_answer", "short_answer parses with rubric");
  if (sa.type === "short_answer") {
    assert(sa.rubric.length > 0 && sa.expectedAnswer.length > 0, "rubric + model answer present");
  }

  // --- generateQuestion: wrong type / bad JSON rejected ---
  let threw = false;
  try {
    await generateQuestion("C", ctx, "mcq", "easy", () =>
      Promise.resolve(JSON.stringify({ type: "true_false", statement: "x", answer: true })),
    );
  } catch (e) {
    threw = e instanceof LlmError;
  }
  assert(threw, "type mismatch (asked mcq, got true_false) throws LlmError");

  threw = false;
  try {
    await generateQuestion("C", ctx, "mcq", "easy", () => Promise.resolve("not json"));
  } catch (e) {
    threw = e instanceof LlmError;
  }
  assert(threw, "unparseable JSON throws LlmError");

  threw = false;
  try {
    await generateQuestion("C", ctx, "mcq", "easy", () =>
      Promise.resolve(JSON.stringify({ type: "mcq", stem: "x", options: ["only"], correctIndex: 9 })),
    );
  } catch (e) {
    threw = e instanceof LlmError;
  }
  assert(threw, "schema violation (1 option, index 9) throws LlmError");

  // --- gradeAnswer ---
  const grade = await gradeAnswer(
    "Explain carbon fixation.",
    "RuBisCO fixes CO2 onto RuBP",
    ctx,
    "Mentions RuBisCO; mentions CO2 + RuBP.",
    (system, user) => {
      seen.push({ system, user });
      assert(user.includes("RuBisCO fixes CO2"), "grading prompt carries student answer");
      return Promise.resolve(JSON.stringify({ score: 0.8, explanation: "Covers both key points, terse." }));
    },
  );
  assert(grade.score === 0.8, "partial-credit score passes through");
  assert(grade.explanation.length > 0, "one-line explanation present");

  threw = false;
  try {
    await gradeAnswer("Q", "A", ctx, "R", () =>
      Promise.resolve(JSON.stringify({ score: 1.5, explanation: "too generous" })),
    );
  } catch (e) {
    threw = e instanceof LlmError;
  }
  assert(threw, "out-of-range score (1.5) rejected");

  // --- reteach ---
  const lesson = await reteach("Calvin cycle", ctx, (system, user) => {
    assert(user.includes(ctx), "reteach prompt carries context");
    return Promise.resolve("RuBisCO fixes carbon in the stroma. Misconception: it needs light directly.");
  });
  assert(lesson.includes("RuBisCO"), "reteach returns grounded explanation");

  // --- provider seam ---
  threw = false;
  try {
    providerChatFn("nonexistent-provider");
  } catch (e) {
    threw = e instanceof LlmError;
  }
  assert(threw, "unknown LLM_PROVIDER throws LlmError");

  // --- ollama provider (stubbed fetch, no server) ---
  let sentBody = "";
  const stubFetch = (url: string, init?: RequestInit): Promise<Response> => {
    sentBody = String(init?.body ?? "");
    assert(url.endsWith("/api/chat"), "ollama chat hits /api/chat");
    return Promise.resolve(
      new Response(JSON.stringify({ message: { content: '{"hello":"world"}' } }), { status: 200 }),
    );
  };
  const ollamaChat = ollamaChatFn({ url: "http://x:11434", model: "test-model", fetchFn: stubFetch });
  const reply = await ollamaChat("sys", "hi", { json: true });
  assert(reply === '{"hello":"world"}', "ollama chat returns message content");
  const sent = JSON.parse(sentBody) as Record<string, unknown>;
  assert(sent["model"] === "test-model" && sent["format"] === "json", "ollama request carries model + json format");

  const plainChat = ollamaChatFn({ fetchFn: stubFetch });
  await plainChat("sys", "hi");
  assert(!JSON.parse(String(sentBody) || "{}").format, "non-JSON calls omit format");

  threw = false;
  try {
    const down = ollamaChatFn({
      fetchFn: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await down("sys", "hi");
  } catch (e) {
    threw = e instanceof LlmError && (e as Error).message.includes("ollama serve");
  }
  assert(threw, "ollama down → LlmError hinting 'ollama serve'");

  threw = false;
  try {
    const missing = ollamaChatFn({
      model: "nope",
      fetchFn: () => Promise.resolve(new Response("not found", { status: 404 })),
    });
    await missing("sys", "hi");
  } catch (e) {
    threw = e instanceof LlmError && (e as Error).message.includes("ollama pull nope");
  }
  assert(threw, "missing model → LlmError hinting 'ollama pull'");

  // End-to-end through the seam: generateQuestion over the ollama ChatFn.
  const q = await generateQuestion("Calvin cycle", ctx, "true_false", "easy", () =>
    Promise.resolve(JSON.stringify({ type: "true_false", statement: "s", answer: false })),
  );
  assert(q.type === "true_false", "wrappers work unchanged over any ChatFn");

  console.log(process.exitCode ? "LLM TEST: FAILURES" : "LLM TEST: ALL PASS");
}

void main();
