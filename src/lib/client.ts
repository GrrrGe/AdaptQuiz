// Typed client for the AdaptQuiz API (Step 6, client-side only).
// Every helper throws ApiError(message) on non-2xx so screens show one error UI.

export class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export type Format = "mcq" | "true_false" | "short_answer";
export const ALL_FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "mcq", label: "Multiple Choice", hint: "4 options, fast recall" },
  { id: "true_false", label: "True / False", hint: "quick recognition checks" },
  { id: "short_answer", label: "Short Answer", hint: "deeper recall, partial credit" },
];

export interface Progress {
  mastered: number;
  total: number;
  percent: number;
}

export interface StartSessionRes {
  sessionId: string;
  isShort: boolean;
  chunkCount: number;
  concepts: { id: string; name: string; sourceExcerpt: string }[];
}

export type PublicQuestion =
  | { stem: string; options: string[] }
  | { statement: string }
  | { stem: string };

export interface NextQuestionRes {
  done: boolean;
  progress: Progress;
  pendingId?: string;
  conceptId?: string;
  conceptName?: string;
  sourceExcerpt?: string;
  questionType?: "mcq" | "true_false" | "short_answer";
  difficulty?: "easy" | "medium" | "hard";
  question?: PublicQuestion;
}

export interface SubmitRes {
  score: number;
  explanation: string;
  correctAnswer: string;
  rubric?: string;
  sourceExcerpt: string;
  mastered: boolean;
  concept: { id: string; name: string; masteryScore: number };
  progress: Progress;
  done: boolean;
}

export interface ReteachRes {
  conceptId: string;
  conceptName: string;
  explanation: string;
  sourceExcerpt: string;
}

export interface GuideItemView {
  concept_id: string;
  concept_name: string;
  summary: string;
  keyPoints: string[];
  sourceExcerpt: string;
}

export interface DashboardRes {
  session: { id: string; title: string; enabledFormats: Format[]; createdAt: string };
  concepts: {
    id: string;
    name: string;
    sourceExcerpt: string;
    masteryScore: number;
    attempts: number;
    correctStreak: number;
    lastSeen: string | null;
    mastered: boolean;
  }[];
  progress: Progress;
  recentAttempts: {
    id: string;
    concept_id: string;
    concept_name: string;
    question: string;
    question_type: string;
    user_answer: string;
    score: number;
    created_at: string;
  }[];
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  uploadText: (text: string) =>
    req<{ text: string; chars: number }>("/api/upload", json({ text })),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<{ text: string; chars: number }>("/api/upload", { method: "POST", body: form });
  },
  startSession: (title: string, text: string | null, useDemo: boolean, enabledFormats: Format[]) =>
    req<StartSessionRes>("/api/start-session", json({ title, text, useDemo, enabledFormats })),
  nextQuestion: (sessionId: string) =>
    req<NextQuestionRes>("/api/next-question", json({ sessionId })),
  submitAnswer: (pendingId: string, userAnswer: string | number | boolean) =>
    req<SubmitRes>("/api/submit-answer", json({ pendingId, userAnswer })),
  reteach: (sessionId: string, conceptId: string) =>
    req<ReteachRes>("/api/reteach", json({ sessionId, conceptId })),
  studyGuide: (sessionId: string) =>
    req<{ guides: GuideItemView[] }>("/api/study-guide", json({ sessionId })),
  skipConcept: (conceptId: string) =>
    req<{ skipped: boolean }>("/api/skip-concept", json({ conceptId })),
  skipQuestion: (pendingId: string) =>
    req<{ skipped: boolean }>("/api/skip-question", json({ pendingId })),
  dashboard: (sessionId: string) =>
    req<DashboardRes>(`/api/dashboard?sessionId=${encodeURIComponent(sessionId)}`),
};
