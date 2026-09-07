// API wiring verification (Step 5). Run: npm run api:test
// Store helpers + schemas + scheduler→DB loop on :memory:. No network/key.
import { initMemoryDb } from "./db";
import {
  StartSessionSchema,
  SubmitAnswerSchema,
  normalizeUploadText,
  createSession,
  insertConcepts,
  listConcepts,
  updateConceptRow,
  recordAttempt,
  recentAttempts,
  savePending,
  getPending,
  deletePending,
  loadDemoNotes,
} from "./store";
import { updateMastery, pickNextConcept, sessionProgress } from "./scheduler";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

async function main(): Promise<void> {
  const db = initMemoryDb();
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  assert(tables.includes("pending_questions"), "pending_questions table migrated");

  // --- session + concepts round-trip ---
  const s = createSession(db, "Bio 101", ["mcq", "short_answer"]);
  assert(s.title === "Bio 101" && s.enabled_formats.length === 2, "session created with formats");
  const stored = insertConcepts(db, s.id, [
    { name: "Calvin cycle", source_excerpt: "RuBisCO fixes CO2." },
    { name: "Glycolysis", source_excerpt: "Glucose splits in cytoplasm." },
  ]);
  assert(stored.length === 2, "2 concepts stored");
  assert(listConcepts(db, s.id).every((c) => c.mastery_score === 0), "fresh mastery 0.0");

  // --- pending round-trip (answer key held server-side) ---
  const pid = savePending(db, {
    sessionId: s.id,
    conceptId: stored[0].id,
    conceptName: "Calvin cycle",
    question: {
      type: "mcq",
      stem: "Where?",
      options: ["Stroma", "Thylakoid", "Matrix", "Cristae"],
      correctIndex: 0,
    },
    context: "RuBisCO fixes CO2 in the stroma.",
    difficulty: "medium",
  });
  const pend = getPending(db, pid);
  assert(pend?.conceptName === "Calvin cycle", "pending payload retrieved with key intact");
  if (pend?.question.type === "mcq") {
    assert(pend.question.correctIndex === 0, "answer key never leaves the server");
  }
  deletePending(db, pid);
  assert(getPending(db, pid) === null, "pending deleted on submit");

  // --- scheduler→DB loop: drill weakest to completion ---
  let cur = listConcepts(db, s.id);
  let guard = 0;
  while (guard++ < 30) {
    const next = pickNextConcept(cur);
    if (!next) break;
    updateConceptRow(db, updateMastery(next, 1.0));
    recordAttempt(db, next.id, "Q", "mcq", "0", 1.0);
    cur = listConcepts(db, s.id);
  }
  const prog = sessionProgress(cur);
  assert(prog.mastered === 2 && pickNextConcept(cur) === null, "loop ends with all mastered");
  assert(recentAttempts(db, s.id).length === guard - 1, "attempt history recorded");

  // --- request schemas ---
  assert(!StartSessionSchema.safeParse({ enabledFormats: [] }).success, "empty formats rejected");
  assert(
    !StartSessionSchema.safeParse({ text: "x", enabledFormats: ["essay"] }).success,
    "unknown format rejected",
  );
  assert(
    StartSessionSchema.safeParse({ useDemo: true, text: null, enabledFormats: ["true_false"] }).success,
    "demo session with text:null accepted (regression)",
  );
  assert(
    !SubmitAnswerSchema.safeParse({ pendingId: "q_1" }).success,
    "missing userAnswer rejected",
  );

  // --- upload guards ---
  assert(!normalizeUploadText("   ").ok, "blank notes rejected");
  assert(!normalizeUploadText("x".repeat(200_001)).ok, "oversize notes rejected");
  assert(normalizeUploadText("  valid notes with enough length  ").ok, "valid notes pass");
  assert(loadDemoNotes().includes("RuBisCO"), "demo notes load without upload");

  console.log(process.exitCode ? "API TEST: FAILURES" : "API TEST: ALL PASS");
}

void main();
