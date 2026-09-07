"use client";

import { useState } from "react";
import type { NextQuestionRes, SubmitRes } from "@/lib/client";

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-lg bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500 disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    />
  );
}

function GhostBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-lg border border-zinc-700 px-4 py-2 hover:bg-zinc-800 disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    />
  );
}

/** One-question quiz card: MCQ options / True-False buttons / text box. */
export function QuestionCard({
  q,
  onSubmit,
  busy,
}: {
  q: NextQuestionRes & { questionType: NonNullable<NextQuestionRes["questionType"]> };
  onSubmit: (answer: string | number | boolean) => void;
  busy: boolean;
}) {
  const [mcq, setMcq] = useState<number | null>(null);
  const [text, setText] = useState("");

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{q.conceptName}</span>
        <span className="rounded bg-zinc-800 px-2 py-0.5">
          {q.questionType.replace("_", " ")} · {q.difficulty}
        </span>
      </div>

      {q.questionType === "mcq" && "options" in q.question! && (
        <div className="space-y-2">
          <p className="text-lg">{(q.question as { stem: string }).stem}</p>
          {(q.question as { options: string[] }).options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setMcq(i)}
              className={`block w-full rounded-lg border px-3 py-2 text-left ${
                mcq === i ? "border-sky-500 bg-sky-950" : "border-zinc-700 hover:bg-zinc-800"
              }`}
            >
              <span className="mr-2 text-zinc-500">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          ))}
          <Btn disabled={mcq === null || busy} onClick={() => mcq !== null && onSubmit(mcq)}>
            {busy ? "Grading…" : "Submit"}
          </Btn>
        </div>
      )}

      {q.questionType === "true_false" && "statement" in q.question! && (
        <div className="space-y-3">
          <p className="text-lg">{(q.question as { statement: string }).statement}</p>
          <div className="flex gap-2">
            <Btn disabled={busy} onClick={() => onSubmit(true)} className="flex-1">
              True
            </Btn>
            <GhostBtn disabled={busy} onClick={() => onSubmit(false)} className="flex-1">
              False
            </GhostBtn>
          </div>
        </div>
      )}

      {q.questionType === "short_answer" && "stem" in q.question! && (
        <div className="space-y-3">
          <p className="text-lg">{(q.question as { stem: string }).stem}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="1-3 sentences…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2"
          />
          <Btn disabled={!text.trim() || busy} onClick={() => onSubmit(text.trim())}>
            {busy ? "Grading…" : "Submit"}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** Feedback panel: score + correct answer/rubric + one-line explanation. */
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
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <span className={`text-2xl font-bold ${good ? "text-emerald-400" : "text-amber-400"}`}>
          {Math.round(f.score * 100)}%
        </span>
        <span className="text-sm text-zinc-400">
          {f.concept.name} · {Math.round(f.progress.percent)}% overall
        </span>
      </div>
      <p className="text-zinc-200">{f.explanation}</p>
      <div className="rounded bg-zinc-950 p-3 text-sm">
        <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Answer</p>
        <p>{f.correctAnswer}</p>
        {f.rubric && <p className="mt-2 text-zinc-400">Rubric: {f.rubric}</p>}
        {f.sourceExcerpt && (
          <p className="mt-2 text-xs text-zinc-500">From your notes: “{f.sourceExcerpt}”</p>
        )}
      </div>
      {f.mastered && <p className="text-sm text-emerald-400">Mastered ✓</p>}
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

export { Btn, GhostBtn };
