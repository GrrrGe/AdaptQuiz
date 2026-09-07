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
import { QuestionCard, Feedback, Btn, GhostBtn } from "@/components/quiz";
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
    if (res.done) {
      // still show feedback first; "See results" leads to dashboard
    }
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
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">AdaptQuiz</h1>
        <p className="text-sm text-zinc-400">
          Upload notes. Quiz to mastery.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {phase === "upload" && (
        <div className="space-y-4">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            placeholder="Paste notes…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn disabled={busy || !paste.trim()} onClick={() => continueFromUpload("paste")}>
              {busy ? "Uploading…" : "Use text"}
            </Btn>
            <label className="cursor-pointer rounded-lg border border-zinc-700 px-4 py-2 hover:bg-zinc-800">
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
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-lg font-semibold">Formats</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2"
          />
          <div className="space-y-2">
            {ALL_FORMATS.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-950">
                <input
                  type="checkbox"
                  checked={formats.includes(f.id)}
                  onChange={() => toggle(f.id)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{f.label}</span>
                  <span className="block text-sm text-zinc-400">{f.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn disabled={busy || formats.length === 0} onClick={startSession}>
              Start
            </Btn>
            <GhostBtn onClick={() => setPhase("upload")}>Back</GhostBtn>
          </div>
          <p className="text-xs text-zinc-500">
            Easy first. Harder as you improve.
          </p>
        </div>
      )}

      {phase === "starting" && <p className="text-zinc-400">Reading notes…</p>}

      {(phase === "quiz" || phase === "feedback" || phase === "reteach") &&
        question?.progress && (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${question.progress.percent}%` }}
              />
            </div>
            <span>
              {question.progress.mastered}/{question.progress.total} mastered
            </span>
          </div>
        )}

      {phase === "quiz" && !question && busy && (
        <p className="text-zinc-400">Writing question…</p>
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
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-lg font-semibold">Re-teach: {lesson.conceptName}</h2>
          <p className="whitespace-pre-wrap text-zinc-200">{lesson.explanation}</p>
          {lesson.sourceExcerpt && (
            <p className="text-xs text-zinc-500">From your notes: “{lesson.sourceExcerpt}”</p>
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
            <p className="rounded-lg border border-emerald-900 bg-emerald-950 p-3 text-emerald-200">
              Full mastery reached.
            </p>
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
