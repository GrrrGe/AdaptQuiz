"use client";

import { useState } from "react";
import type { NextQuestionRes, SubmitRes } from "@/lib/client";

const CARD = "rounded-2xl bg-white border border-gray-100 shadow-[0_2px_20px_-4px_rgba(0,0,0,0.08)]";

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-xl bg-[#2C80FF] px-4 py-2 font-semibold text-white hover:bg-[#1f6ff0] disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    />
  );
}

function GhostBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      className={`rounded-xl border border-slate-200 bg-white px-4 py-2 font-medium text-[#3D5A80] hover:bg-slate-50 disabled:opacity-50 ${className ?? ""}`}
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
    <div className={`${CARD} space-y-4 p-5`}>
      <div className="flex items-center justify-between text-xs text-[#94A3B8]">
        <span className="font-semibold uppercase tracking-widest">{q.conceptName}</span>
        <span className="rounded-full bg-[#EAF2FF] px-2 py-0.5 font-medium text-[#2C80FF]">
          {q.questionType.replace("_", " ")} · {q.difficulty}
        </span>
      </div>

      {q.questionType === "mcq" && "options" in q.question! && (
        <div className="space-y-2">
          <p className="text-lg font-medium text-[#3D5A80]">{(q.question as { stem: string }).stem}</p>
          {(q.question as { options: string[] }).options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setMcq(i)}
              className={`block w-full rounded-xl border px-3 py-2 text-left text-[#3D5A80] ${
                mcq === i
                  ? "border-[#2C80FF] bg-[#EAF2FF]"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="mr-2 font-semibold text-[#2C80FF]">{String.fromCharCode(65 + i)}.</span>
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
          <p className="text-lg font-medium text-[#3D5A80]">{(q.question as { statement: string }).statement}</p>
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
          <p className="text-lg font-medium text-[#3D5A80]">{(q.question as { stem: string }).stem}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="1-3 sentences…"
            className="w-full rounded-xl border border-slate-200 bg-white p-2 text-[#3D5A80] placeholder:text-[#94A3B8]"
          />
          <Btn disabled={!text.trim() || busy} onClick={() => onSubmit(text.trim())}>
            {busy ? "Grading…" : "Submit"}
          </Btn>
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
        <span className={`text-3xl font-bold ${good ? "text-emerald-500" : "text-amber-500"}`}>
          {Math.round(f.score * 100)}%
        </span>
        <span className="text-sm text-[#94A3B8]">
          {f.concept.name} · {Math.round(f.progress.percent)}% overall
        </span>
      </div>
      <p className="text-[#3D5A80]">{f.explanation}</p>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#94A3B8]">Answer</p>
        <p className="text-[#3D5A80]">{f.correctAnswer}</p>
        {f.rubric && <p className="mt-2 text-[#64748B]">Rubric: {f.rubric}</p>}
        {f.sourceExcerpt && (
          <p className="mt-2 text-xs text-[#94A3B8]">From your notes: “{f.sourceExcerpt}”</p>
        )}
      </div>
      {f.mastered && <p className="text-sm font-semibold text-emerald-500">Mastered ✓</p>}
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

export { Btn, GhostBtn, CARD };
