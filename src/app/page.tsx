"use client";

import { useState } from "react";
import {
  api,
  ApiError,
  ALL_FORMATS,
  type Format,
  type NextQuestionRes,
  type SubmitRes,
  type ReteachRes,
  type DashboardRes,
} from "@/lib/client";
import { QuestionCard, Feedback, Btn, GhostBtn, CARD } from "@/components/quiz";
import { Dashboard } from "@/components/dashboard";

type Phase =
  | "upload"
  | "formats"
  | "starting"
  | "quiz"
  | "feedback"
  | "reteach"
  | "dashboard"
  | "complete";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // upload
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notesText, setNotesText] = useState<string | null>(null);
  const [useDemo, setUseDemo] = useState(false);

  // formats
  const [title, setTitle] = useState("");
  const [formats, setFormats] = useState<Format[]>(["mcq", "true_false", "short_answer"]);

  // session
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState<NextQuestionRes | null>(null);
  const [feedback, setFeedback] = useState<SubmitRes | null>(null);
  const [lesson, setLesson] = useState<ReteachRes | null>(null);
  const [dash, setDash] = useState<DashboardRes | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ---- upload → formats ----
  async function continueFromUpload(kind: "paste" | "file" | "demo") {
    if (kind === "demo") {
      setNotesText(null);
      setUseDemo(true);
      setPhase("formats");
      return;
    }
    const res = await run(() =>
      kind === "file" && file ? api.uploadFile(file) : api.uploadText(paste),
    );
    if (!res) return;
    setNotesText(res.text);
    setUseDemo(false);
    setPhase("formats");
  }

  // ---- formats → quiz ----
  async function startSession() {
    if (formats.length === 0) {
      setError("Pick at least one format.");
      return;
    }
    setPhase("starting");
    const res = await run(() => api.startSession(title || "Untitled session", notesText, useDemo, formats));
    if (!res) {
      setPhase("formats");
      return;
    }
    setSessionId(res.sessionId);
    await loadNext(res.sessionId);
  }

  async function loadNext(sid: string = sessionId!) {
    setPhase("quiz");
    const res = await run(() => api.nextQuestion(sid));
    if (!res) return;
    if (res.done) {
      await showDashboard(sid, true);
      return;
    }
    setQuestion(res);
    setFeedback(null);
  }

  async function submit(answer: string | number | boolean) {
    if (!question?.pendingId) return;
    const res = await run(() => api.submitAnswer(question.pendingId!, answer));
    if (!res) return;
    setFeedback(res);
    setPhase("feedback");
  }

  async function showReteach() {
    if (!sessionId || !feedback) return;
    const res = await run(() => api.reteach(sessionId, feedback.concept.id));
    if (!res) return;
    setLesson(res);
    setPhase("reteach");
  }

  async function showDashboard(sid: string = sessionId!, complete = false) {
    const res = await run(() => api.dashboard(sid));
    if (!res) return;
    setDash(res);
    setPhase(complete || res.progress.percent === 100 ? "complete" : "dashboard");
  }

  const toggle = (f: Format) =>
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  return (
    <div className="space-y-5">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#2C80FF]">
          Adaptive study
        </p>
        <h1 className="mt-1 text-4xl font-bold text-[#3D5A80]">AdaptQuiz</h1>
        <p className="mt-1 text-sm text-[#64748B]">Upload notes. Quiz to mastery.</p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {phase === "upload" && (
        <div className={`${CARD} space-y-4 p-5`}>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={7}
            placeholder="Paste notes…"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-[#3D5A80] placeholder:text-[#94A3B8]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn disabled={busy || !paste.trim()} onClick={() => continueFromUpload("paste")}>
              {busy ? "Uploading…" : "Use text"}
            </Btn>
            <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2 font-medium text-[#3D5A80] hover:bg-slate-50">
              {file ? file.name : "Choose PDF / .txt"}
              <input
                type="file"
                accept=".pdf,.txt"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && (
              <Btn disabled={busy} onClick={() => continueFromUpload("file")}>
                {busy ? "Uploading…" : "Upload"}
              </Btn>
            )}
            <GhostBtn disabled={busy} onClick={() => continueFromUpload("demo")}>
              Try demo notes
            </GhostBtn>
          </div>
        </div>
      )}

      {phase === "formats" && (
        <div className={`${CARD} space-y-4 p-5`}>
          <h2 className="text-lg font-semibold text-[#3D5A80]">Formats</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-xl border border-slate-200 bg-white p-2 text-[#3D5A80] placeholder:text-[#94A3B8]"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            {ALL_FORMATS.map((f) => {
              const on = formats.includes(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className={`rounded-xl border p-3 text-left ${
                    on ? "border-[#2C80FF] bg-[#EAF2FF]" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-[#3D5A80]">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md text-xs text-white ${on ? "bg-[#2C80FF]" : "bg-slate-200"}`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    {f.label}
                  </span>
                  <span className="mt-1 block text-xs text-[#94A3B8]">{f.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Btn disabled={busy || formats.length === 0} onClick={startSession}>
              Start
            </Btn>
            <GhostBtn onClick={() => setPhase("upload")}>Back</GhostBtn>
          </div>
          <p className="text-xs text-[#94A3B8]">Easy first. Harder as you improve.</p>
        </div>
      )}

      {phase === "starting" && (
        <div className={`${CARD} p-5 text-center text-[#64748B]`}>
          <p className="text-2xl font-bold text-[#2C80FF]">Reading notes…</p>
          <p className="mt-1 text-sm">Extracting concepts. This takes a minute.</p>
        </div>
      )}

      {(phase === "quiz" || phase === "feedback" || phase === "reteach") &&
        question?.progress && (
          <div className={`${CARD} flex items-center gap-3 p-4`}>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#2C80FF] transition-all"
                style={{ width: `${question.progress.percent}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-[#2C80FF]">
              {question.progress.mastered}/{question.progress.total}
            </span>
          </div>
        )}

      {phase === "quiz" && !question && busy && (
        <div className={`${CARD} p-5 text-center text-[#64748B]`}>Writing question…</div>
      )}
      {phase === "quiz" && question?.questionType && (
        <QuestionCard
          q={question as NextQuestionRes & { questionType: NonNullable<NextQuestionRes["questionType"]> }}
          busy={busy}
          onSubmit={submit}
        />
      )}

      {phase === "feedback" && feedback && (
        <Feedback
          f={feedback}
          busy={busy}
          onNext={() => (feedback.done ? showDashboard() : loadNext())}
          onReteach={showReteach}
          onDashboard={() => showDashboard()}
        />
      )}

      {phase === "reteach" && lesson && (
        <div className={`${CARD} space-y-4 p-5`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#2C80FF]">
            Re-teach
          </p>
          <h2 className="text-lg font-semibold text-[#3D5A80]">{lesson.conceptName}</h2>
          <p className="whitespace-pre-wrap text-[#3D5A80]">{lesson.explanation}</p>
          {lesson.sourceExcerpt && (
            <p className="text-xs text-[#94A3B8]">From your notes: “{lesson.sourceExcerpt}”</p>
          )}
          <div className="flex gap-2">
            <Btn disabled={busy} onClick={() => loadNext()}>
              {busy ? "Loading…" : "Re-quiz"}
            </Btn>
            <GhostBtn onClick={() => showDashboard()}>Dashboard</GhostBtn>
          </div>
        </div>
      )}

      {(phase === "dashboard" || phase === "complete") && dash && (
        <div className="space-y-4">
          {phase === "complete" && (
            <div className="rounded-2xl bg-[#2C80FF] p-5 text-center text-white shadow-[0_2px_20px_-4px_rgba(44,128,255,0.5)]">
              <p className="text-2xl font-bold">Full mastery reached.</p>
              <p className="mt-1 text-sm text-white/70">Every concept learned.</p>
            </div>
          )}
          <Dashboard data={dash} />
          <div className="flex gap-2">
            {phase !== "complete" && (
              <Btn disabled={busy} onClick={() => loadNext()}>
                Continue
              </Btn>
            )}
            <GhostBtn onClick={() => setPhase("upload")}>New session</GhostBtn>
          </div>
        </div>
      )}
    </div>
  );
}
