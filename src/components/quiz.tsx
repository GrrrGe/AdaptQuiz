"use client";

import { useEffect, useState } from "react";
import type { NextQuestionRes, SubmitRes } from "@/lib/client";

const CARD = "rounded-2xl border border-zinc-800 bg-zinc-900";

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-xl bg-white px-4 py-2 font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    />
  );
}

function GhostBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-xl border border-zinc-700 bg-transparent px-4 py-2 font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    />
  );
}

/** Round arrow submit, StudyChat style. */
function ArrowBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      aria-label="Submit"
      className={`flex h-7 w-7 items-center justify-center rounded-full bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-40 ${className ?? ""}`}
      {...rest}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    </button>
  );
}

/** One-question quiz card: MCQ options / True-False buttons / text box. */
export function QuestionCard({
  q,
  onSubmit,
  onSkip,
  busy,
}: {
  q: NextQuestionRes & { questionType: NonNullable<NextQuestionRes["questionType"]> };
  onSubmit: (answer: string | number | boolean) => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const [mcq, setMcq] = useState<number | null>(null);
  const [text, setText] = useState("");

  // Keys: 1-4/A-D pick MCQ, Enter submits, T/F answers true/false,
  // Cmd/Ctrl+Enter submits short answer.
  useEffect(() => {
    setMcq(null);
    setText("");
  }, [q.pendingId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (q.questionType === "short_answer") {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) onSubmit(text.trim());
        return;
      }
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (q.questionType === "mcq" && "options" in q.question!) {
        const n = (q.question as { options: string[] }).options.length;
        const idx =
          /^[1-9]$/.test(e.key) ? parseInt(e.key, 10) - 1
          : /^[a-dA-D]$/.test(e.key) ? e.key.toLowerCase().charCodeAt(0) - 97
          : -1;
        if (idx >= 0 && idx < n) {
          setMcq(idx);
          return;
        }
        if (e.key === "Enter" && mcq !== null) onSubmit(mcq);
        return;
      }
      if (q.questionType === "true_false") {
        if (e.key === "t" || e.key === "T") onSubmit(true);
        if (e.key === "f" || e.key === "F") onSubmit(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, mcq, text, busy, onSubmit]);

  return (
    <div className={`${CARD} space-y-4 p-5`}>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="font-semibold uppercase tracking-widest">{q.conceptName}</span>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-medium text-zinc-300">
          {q.questionType.replace("_", " ")} · {q.difficulty}
        </span>
      </div>

      {q.questionType === "mcq" && "options" in q.question! && (
        <div className="space-y-2">
          <p className="text-lg font-medium">{(q.question as { stem: string }).stem}</p>
          {(q.question as { options: string[] }).options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setMcq(i)}
              className={`block w-full rounded-xl border px-3 py-2 text-left ${
                mcq === i
                  ? "border-white bg-zinc-800"
                  : "border-zinc-800 bg-transparent hover:bg-zinc-800/60"
              }`}
            >
              <span className="mr-2 font-semibold text-zinc-500">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          ))}
          <div className="flex gap-2">
            <Btn disabled={mcq === null || busy} onClick={() => mcq !== null && onSubmit(mcq)}>
              {busy ? "Grading…" : "Submit"}
            </Btn>
            <GhostBtn disabled={busy} onClick={onSkip}>
              Skip
            </GhostBtn>
          </div>
          <p className="text-xs text-zinc-600">Keys 1-4 or A-D pick. Enter submits.</p>
        </div>
      )}

      {q.questionType === "true_false" && "statement" in q.question! && (
        <div className="space-y-3">
          <p className="text-lg font-medium">{(q.question as { statement: string }).statement}</p>
          <div className="flex gap-2">
            <Btn disabled={busy} onClick={() => onSubmit(true)} className="flex-1">
              True
            </Btn>
            <GhostBtn disabled={busy} onClick={() => onSubmit(false)} className="flex-1">
              False
            </GhostBtn>
            <GhostBtn disabled={busy} onClick={onSkip}>
              Skip
            </GhostBtn>
          </div>
          <p className="text-xs text-zinc-600">Keys T or F answer.</p>
        </div>
      )}

      {q.questionType === "short_answer" && "stem" in q.question! && (
        <div className="space-y-3">
          <p className="text-lg font-medium">{(q.question as { stem: string }).stem}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="1-3 sentences…"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2 placeholder:text-zinc-600"
          />
          <div className="flex gap-2">
            <Btn disabled={!text.trim() || busy} onClick={() => onSubmit(text.trim())}>
              {busy ? "Grading…" : "Submit"}
            </Btn>
            <GhostBtn disabled={busy} onClick={onSkip}>
              Skip
            </GhostBtn>
          </div>
          <p className="text-xs text-zinc-600">Cmd+Enter submits.</p>
        </div>
      )}
    </div>
  );
}

/** Feedback panel: score + answer/rubric + one-line explanation. */
export function Feedback({
  f,
  onNext,
  onReteach,
  onDashboard,
  busy,
}: {
  f: SubmitRes;
  onNext: () => void;
  onReteach: () => void;
  onDashboard: () => void;
  busy: boolean;
}) {
  const good = f.score >= 0.8;
  return (
    <div className={`${CARD} space-y-4 p-5`}>
      <div className="flex items-center justify-between">
        <span className={`text-3xl font-bold ${good ? "text-emerald-400" : "text-amber-400"}`}>
          {Math.round(f.score * 100)}%
        </span>
        <span className="text-sm text-zinc-500">
          {f.concept.name} · {Math.round(f.progress.percent)}% overall
        </span>
      </div>
      <p className="text-zinc-200">{f.explanation}</p>
      <div className="rounded-xl bg-zinc-950 p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">Answer</p>
        <p className="text-zinc-100">{f.correctAnswer}</p>
        {f.rubric && <p className="mt-2 text-zinc-400">Rubric: {f.rubric}</p>}
        {f.sourceExcerpt && (
          <p className="mt-2 text-xs text-zinc-500">From your notes: “{f.sourceExcerpt}”</p>
        )}
      </div>
      {f.mastered && <p className="text-sm font-semibold text-emerald-400">Mastered ✓</p>}
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={onNext}>
          {busy ? "Loading…" : f.done ? "Results" : "Next"}
        </Btn>
        {!f.mastered && (
          <GhostBtn disabled={busy} onClick={onReteach}>
            Re-teach
          </GhostBtn>
        )}
        <GhostBtn disabled={busy} onClick={onDashboard}>
          Dashboard
        </GhostBtn>
      </div>
    </div>
  );
}

export { Btn, GhostBtn, ArrowBtn, CARD };
