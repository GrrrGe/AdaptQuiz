// Scheduler verification (Step 4). Run: npm run scheduler:test
// Pure logic — no DB, no network, no API key.
import type { Concept } from "./types";
import {
  pickNextConcept,
  pickTypeAndDifficulty,
  updateMastery,
  isMastered,
  isSessionComplete,
  sessionProgress,
  gradeMcq,
  gradeTrueFalse,
} from "./scheduler";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

function concept(over: Partial<Concept> & { id: string; name: string }): Concept {
  return {
    session_id: "s",
    source_excerpt: "",
    mastery_score: 0,
    attempts: 0,
    correct_streak: 0,
    last_seen: null,
    ...over,
  };
}

async function main(): Promise<void> {
  // --- pickNextConcept: lowest mastery wins ---
  const a = concept({ id: "a", name: "A", mastery_score: 0.5, last_seen: "2026-01-01T00:00:00Z" });
  const b = concept({ id: "b", name: "B", mastery_score: 0.1, last_seen: "2026-06-01T00:00:00Z" });
  assert(pickNextConcept([a, b])?.id === "b", "lowest mastery picked despite older rival");

  // --- tiebreak: longest unseen (null = oldest) ---
  const old = concept({ id: "old", name: "O", mastery_score: 0.2, last_seen: "2025-01-01T00:00:00Z" });
  const fresh = concept({ id: "new", name: "N", mastery_score: 0.2, last_seen: "2026-09-01T00:00:00Z" });
  const never = concept({ id: "never", name: "V", mastery_score: 0.2, last_seen: null });
  assert(pickNextConcept([fresh, old])?.id === "old", "tie broken by longest-since-seen");
  assert(pickNextConcept([fresh, never])?.id === "never", "never-seen counts as oldest");

  // --- mastered concepts are skipped; null when done ---
  const done = concept({ id: "d", name: "D", mastery_score: 0.9, correct_streak: 3 });
  assert(pickNextConcept([done, a])?.id === "a", "mastered concept never re-quizzed");
  assert(pickNextConcept([done]) === null, "null when all mastered");
  assert(pickNextConcept([]) === null, "null on empty list");

  // --- pickTypeAndDifficulty: coupling with all formats enabled ---
  const all = ["mcq", "true_false", "short_answer"] as const;
  const low = concept({ id: "l", name: "L", mastery_score: 0.0 });
  const mid = concept({ id: "m", name: "M", mastery_score: 0.5 });
  const high = concept({ id: "h", name: "H", mastery_score: 0.8 });
  assert(
    JSON.stringify(pickTypeAndDifficulty(low, [...all])) ===
      JSON.stringify({ type: "true_false", difficulty: "easy" }),
    "low mastery → true_false/easy",
  );
  assert(
    JSON.stringify(pickTypeAndDifficulty(mid, [...all])) ===
      JSON.stringify({ type: "mcq", difficulty: "medium" }),
    "mid mastery → mcq/medium",
  );
  assert(
    JSON.stringify(pickTypeAndDifficulty(high, [...all])) ===
      JSON.stringify({ type: "short_answer", difficulty: "hard" }),
    "high mastery → short_answer/hard",
  );
  // Band edges: 0.4 → medium, 0.7 → medium, just above 0.7 → hard.
  assert(
    pickTypeAndDifficulty(concept({ id: "e1", name: "E", mastery_score: 0.4 }), [...all]).difficulty ===
      "medium",
    "0.4 is medium band",
  );
  assert(
    pickTypeAndDifficulty(concept({ id: "e2", name: "E", mastery_score: 0.70001 }), [...all]).type ===
      "short_answer",
    "just above 0.7 prefers short_answer",
  );

  // --- fallback when preferred type disabled ---
  assert(
    pickTypeAndDifficulty(low, ["mcq", "short_answer"]).type === "mcq",
    "low mastery without true_false falls back to mcq",
  );
  assert(
    pickTypeAndDifficulty(low, ["short_answer"]).type === "short_answer",
    "single enabled format always served (low)",
  );
  assert(
    pickTypeAndDifficulty(high, ["short_answer"]).type === "short_answer",
    "single enabled format always served (high)",
  );
  assert(
    pickTypeAndDifficulty(high, ["mcq", "true_false"]).type === "mcq",
    "high mastery without short_answer falls back to mcq",
  );
  assert(
    pickTypeAndDifficulty(mid, ["true_false"]).type === "true_false",
    "medium mastery with only true_false serves true_false",
  );
  let threw = false;
  try {
    pickTypeAndDifficulty(low, []);
  } catch {
    threw = true;
  }
  assert(threw, "empty enabled formats throws");

  // --- updateMastery math ---
  const c0 = concept({ id: "c", name: "C", mastery_score: 0.5, correct_streak: 2 });
  const up1 = updateMastery(c0, 1.0, "2026-09-07T00:00:00Z");
  assert(Math.abs(up1.mastery_score - 0.7) < 1e-9, "0.6*0.5 + 0.4*1.0 = 0.7");
  assert(up1.correct_streak === 3 && up1.attempts === 1, "correct extends streak, attempts++");
  assert(up1.last_seen === "2026-09-07T00:00:00Z", "last_seen stamped");

  const up0 = updateMastery(c0, 0.0);
  assert(Math.abs(up0.mastery_score - 0.3) < 1e-9, "0.6*0.5 + 0.4*0.0 = 0.3");
  assert(up0.correct_streak === 0, "wrong resets streak");

  // Correctness cutoff at 0.8.
  assert(updateMastery(c0, 0.8).correct_streak === 3, "0.8 counts as correct");
  assert(updateMastery(c0, 0.79).correct_streak === 0, "0.79 resets streak");

  threw = false;
  try {
    updateMastery(c0, 1.5);
  } catch {
    threw = true;
  }
  assert(threw, "out-of-range result throws");

  // --- isMastered boundaries ---
  assert(isMastered(concept({ id: "x", name: "X", mastery_score: 0.85, correct_streak: 3 })), "0.85 + streak 3 mastered");
  assert(!isMastered(concept({ id: "x", name: "X", mastery_score: 0.849, correct_streak: 5 })), "0.849 not mastered");
  assert(!isMastered(concept({ id: "x", name: "X", mastery_score: 0.95, correct_streak: 2 })), "streak 2 not mastered");

  // --- session completion + progress ---
  assert(!isSessionComplete([]), "empty session not complete");
  assert(!isSessionComplete([done, a]), "one weak concept → incomplete");
  assert(isSessionComplete([done]), "all mastered → complete");
  const prog = sessionProgress([done, a, b]);
  assert(prog.mastered === 1 && prog.total === 3, "progress counts");
  assert(Math.abs(prog.percent - 100 / 3) < 1e-9, "percent = mastered/total");

  // --- exact grading (no LLM) ---
  assert(gradeMcq(2, 2) === 1.0 && gradeMcq(2, 0) === 0.0, "mcq exact match");
  assert(gradeTrueFalse(true, true) === 1.0 && gradeTrueFalse(true, false) === 0.0, "true/false exact match");

  // --- end-to-end miniature: weak concept climbs to mastery ---
  let cur = concept({ id: "w", name: "W" });
  const picks: string[] = [];
  for (let i = 0; i < 6 && !isMastered(cur); i++) {
    const next = pickNextConcept([cur, done]);
    picks.push(next!.id);
    cur = updateMastery(cur, 1.0);
  }
  assert(isMastered(cur) && picks.every((p) => p === "w"), "weak concept drilled to mastery, mastered left alone");
  const n = picks.length;
  assert(Math.abs(cur.mastery_score - (1 - Math.pow(0.6, n))) < 1e-9, `EMA from 0 converges as 1-0.6^n (n=${n})`);

  console.log(process.exitCode ? "SCHEDULER TEST: FAILURES" : "SCHEDULER TEST: ALL PASS");
}

void main();
