"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  ALL_FORMATS,
  type Format,
  type NextQuestionRes,
  type SubmitRes,
  type ReteachRes,
  type DashboardRes,
  type GuideItemView,
} from "@/lib/client";
import { QuestionCard, Feedback, Btn, GhostBtn, ArrowBtn, CARD } from "@/components/quiz";
import { Dashboard } from "@/components/dashboard";

type Phase =
  | "upload"
  | "formats"
  | "starting"
  | "guide"
  | "quiz"
  | "feedback"
  | "reteach"
  | "dashboard"
  | "complete";

interface Space {
  id: string;
  title: string;
}

const SPACES_KEY = "adaptquiz-spaces";

function loadSpaces(): Space[] {
  try {
    return JSON.parse(localStorage.getItem(SPACES_KEY) ?? "[]") as Space[];
  } catch {
    return [];
  }
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </svg>
  );
}

function Steps({ phase }: { phase: Phase }) {
  const steps = ["Upload", "Learn", "Quiz", "Done"];
  const active =
    phase === "upload" ? 0
    : phase === "formats" || phase === "starting" ? 0
    : phase === "guide" ? 1
    : phase === "complete" || phase === "dashboard" ? 3
    : 2;
  return (
    <div className="flex items-center justify-center gap-1 text-xs">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              i <= active ? "bg-white text-zinc-950" : "text-zinc-600"
            }`}
          >
            {s}
          </span>
          {i < steps.length - 1 && <span className="text-zinc-700">›</span>}
        </span>
      ))}
    </div>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(true);

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
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [guides, setGuides] = useState<GuideItemView[]>([]);
  const [question, setQuestion] = useState<NextQuestionRes | null>(null);
  const [feedback, setFeedback] = useState<SubmitRes | null>(null);
  const [lesson, setLesson] = useState<ReteachRes | null>(null);
  const [dash, setDash] = useState<DashboardRes | null>(null);

  useEffect(() => {
    setSpaces(loadSpaces());
  }, []);

  function rememberSpace(id: string, title: string) {
    setSpaces((prev) => {
      const next = [{ id, title }, ...prev.filter((s) => s.id !== id)].slice(0, 20);
      try {
        localStorage.setItem(SPACES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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

  function newQuiz() {
    setPhase("upload");
    setError(null);
    setPaste("");
    setFile(null);
    setNotesText(null);
    setUseDemo(false);
    setTitle("");
    setSessionId(null);
    setGuides([]);
    setQuestion(null);
    setFeedback(null);
    setLesson(null);
    setDash(null);
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

  // ---- formats → guide ----
  async function startSession() {
    if (formats.length === 0) {
      setError("Pick at least one format.");
      return;
    }
    setPhase("starting");
    const sessionTitle = title || "Untitled session";
    const res = await run(() => api.startSession(sessionTitle, notesText, useDemo, formats));
    if (!res) {
      setPhase("formats");
      return;
    }
    setSessionId(res.sessionId);
    rememberSpace(res.sessionId, sessionTitle);
    await loadGuide(res.sessionId);
  }

  async function loadGuide(sid: string) {
    setPhase("guide");
    const res = await run(() => api.studyGuide(sid));
    if (!res) return;
    setGuides(res.guides);
  }

  async function skipConcept(conceptId: string) {
    const res = await run(() => api.skipConcept(conceptId));
    if (!res) return;
    setGuides((prev) => prev.filter((g) => g.concept_id !== conceptId));
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

  async function skipQuestion() {
    if (!question?.pendingId) return;
    const res = await run(() => api.skipQuestion(question.pendingId!));
    if (!res) return;
    await loadNext();
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
    setSessionId(res.session.id);
    setPhase(complete || res.progress.percent === 100 ? "complete" : "dashboard");
  }

  const toggle = (f: Format) =>
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const inFlow = phase !== "upload";

  return (
    <div className="flex min-h-svh w-full">
      {/* sidebar */}
      {sidebar && (
        <aside className="fixed inset-y-0 left-0 z-10 hidden w-[250px] flex-col border-r border-zinc-800 bg-zinc-950 md:flex">
          <div className="p-2">
            <div className="flex items-center gap-2 rounded-lg p-1">
              <div className="flex size-8 items-center justify-center rounded-lg bg-white font-bold text-zinc-950">
                A
              </div>
              <span className="font-semibold">AdaptQuiz</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-auto p-2">
            <button
              onClick={newQuiz}
              className="flex w-full items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              <span>New quiz</span>
            </button>
            <p className="px-2 pt-2 text-xs font-semibold text-zinc-500">Quizzes</p>
            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              {spaces.length === 0 ? (
                <p className="mt-4 px-2 text-center text-xs text-zinc-600">No quizzes yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {spaces.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => showDashboard(s.id)}
                        className={`w-full truncate rounded-md p-2 text-left text-sm hover:bg-zinc-800 ${
                          s.id === sessionId ? "bg-zinc-800 font-medium" : "text-zinc-400"
                        }`}
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="p-2">
            <button
              onClick={() => setSidebar(false)}
              className="w-full rounded-md p-2 text-left text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
            >
              Toggle sidebar
            </button>
          </div>
        </aside>
      )}

      {/* main */}
      <main className={`relative flex min-h-svh flex-1 flex-col ${sidebar ? "md:pl-[250px]" : ""}`}>
        <div className="absolute left-4 top-4">
          {!sidebar && (
            <button
              onClick={() => setSidebar(true)}
              aria-label="Toggle sidebar"
              className="rounded-md p-1 hover:bg-zinc-800"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <line x1="9" x2="9" y1="3" y2="21" />
              </svg>
            </button>
          )}
        </div>

        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          {inFlow && (
            <div className="mb-6">
              <Steps phase={phase} />
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {phase === "upload" && (
            <div>
              <div className="mb-8 text-center">
                <h1 className="text-4xl font-bold">Welcome,</h1>
                <p className="mt-2 text-xl text-zinc-400">What will you learn today?</p>
              </div>

              <div className={`${CARD} w-full p-2`}>
                <div className="relative">
                  <textarea
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={2}
                    placeholder="Paste notes…"
                    className="max-h-[200px] min-h-[40px] w-full resize-none border-0 bg-transparent px-3 py-2 text-sm font-medium shadow-none placeholder:text-zinc-600 focus:outline-none"
                  />
                  <ArrowBtn
                    className="absolute right-2 top-2"
                    disabled={busy || !paste.trim()}
                    onClick={() => continueFromUpload("paste")}
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="flex h-32 w-full cursor-pointer flex-col items-start justify-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 transition-all hover:border-zinc-600 hover:bg-zinc-900">
                  <UploadIcon />
                  <span>
                    <span className="block text-sm font-medium sm:text-base">
                      {file ? file.name : "Upload"}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-zinc-500 sm:text-xs">
                      PDF, .txt
                    </span>
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.txt"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  onClick={() => (file ? continueFromUpload("file") : continueFromUpload("demo"))}
                  disabled={busy}
                  className="flex h-32 w-full cursor-pointer flex-col items-start justify-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-left transition-all hover:border-zinc-600 hover:bg-zinc-900 disabled:opacity-50"
                >
                  <TextIcon />
                  <span>
                    <span className="block text-sm font-medium sm:text-base">
                      {file ? "Start quiz" : "Demo"}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-zinc-500 sm:text-xs">
                      {file ? "Use uploaded file" : "Sample notes"}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          )}

          {phase === "formats" && (
            <div className={`${CARD} space-y-4 p-5`}>
              <h2 className="text-lg font-semibold">Formats</h2>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2 placeholder:text-zinc-600"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {ALL_FORMATS.map((f) => {
                  const on = formats.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggle(f.id)}
                      className={`rounded-xl border p-3 text-left ${
                        on ? "border-white bg-zinc-800" : "border-zinc-800 hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-md text-xs ${on ? "bg-white text-zinc-950" : "bg-zinc-800 text-transparent"}`}
                        >
                          ✓
                        </span>
                        {f.label}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500">{f.hint}</span>
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
              <p className="text-xs text-zinc-600">Easy first. Harder as you improve.</p>
            </div>
          )}

          {phase === "starting" && (
            <div className={`${CARD} space-y-2 p-5 text-center`}>
              <div className="flex items-center justify-center gap-1">
                <div className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.3s]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.15s]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-white" />
              </div>
              <p className="text-sm text-zinc-400">Reading notes…</p>
            </div>
          )}

          {phase === "guide" && (
            <div className="space-y-4">
              {busy && guides.length === 0 ? (
                <div className={`${CARD} space-y-2 p-5 text-center`}>
                  <div className="flex items-center justify-center gap-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.3s]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-white [animation-delay:-0.15s]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-white" />
                  </div>
                  <p className="text-sm text-zinc-400">Writing your guide…</p>
                </div>
              ) : (
                <>
                  <div className="text-center">
                    <h2 className="text-2xl font-bold">Learn first.</h2>
                    <p className="mt-1 text-sm text-zinc-400">
                      Read each concept. Skip what you know. Then quiz.
                    </p>
                  </div>
                  {guides.map((g) => (
                    <div key={g.concept_id} className={`${CARD} space-y-2 p-5`}>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold">{g.concept_name}</h3>
                        <button
                          onClick={() => skipConcept(g.concept_id)}
                          disabled={busy}
                          className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          Know it
                        </button>
                      </div>
                      <p className="text-sm leading-relaxed text-zinc-300">{g.summary}</p>
                      <ul className="space-y-1">
                        {g.keyPoints.map((k, i) => (
                          <li key={i} className="flex gap-2 text-sm text-zinc-400">
                            <span className="text-zinc-600">•</span>
                            {k}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Btn disabled={busy || guides.length === 0} onClick={() => loadNext()}>
                      {busy ? "Loading…" : "Start quiz"}
                    </Btn>
                    <GhostBtn onClick={() => showDashboard()}>Dashboard</GhostBtn>
                  </div>
                </>
              )}
            </div>
          )}

          {(phase === "quiz" || phase === "feedback" || phase === "reteach") &&
            question?.progress && (
              <div className={`${CARD} mb-4 flex items-center gap-3 p-4`}>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-white transition-all"
                    style={{ width: `${question.progress.percent}%` }}
                  />
                </div>
                <span className="text-sm font-semibold">
                  {question.progress.mastered}/{question.progress.total}
                </span>
              </div>
            )}

          {phase === "quiz" && !question && busy && (
            <div className={`${CARD} p-5 text-center text-sm text-zinc-400`}>Writing question…</div>
          )}
          {phase === "quiz" && question?.questionType && (
            <QuestionCard
              q={question as NextQuestionRes & { questionType: NonNullable<NextQuestionRes["questionType"]> }}
              busy={busy}
              onSubmit={submit}
              onSkip={skipQuestion}
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
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Re-teach
              </p>
              <h2 className="text-lg font-semibold">{lesson.conceptName}</h2>
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
                <div className="rounded-2xl bg-white p-5 text-center text-zinc-950">
                  <p className="text-2xl font-bold">Full mastery reached.</p>
                  <p className="mt-1 text-sm text-zinc-600">Every concept learned.</p>
                </div>
              )}
              <Dashboard data={dash} />
              <div className="flex gap-2">
                {phase !== "complete" && (
                  <Btn disabled={busy} onClick={() => loadNext()}>
                    Continue
                  </Btn>
                )}
                <GhostBtn onClick={newQuiz}>New quiz</GhostBtn>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
