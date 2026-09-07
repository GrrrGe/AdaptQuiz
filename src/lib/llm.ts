// Typed LLM wrapper for AdaptQuiz (Step 3).
//
// The LLM is used ONLY for: concept extraction, question generation (given a
// concept + retrieved context + type + difficulty), short-answer grading, and
// re-teach explanations. All adaptive decisions live in scheduler.ts (Step 4).
//
// Provider is swappable via LLM_PROVIDER env var ("openai" | "ollama").
// Tests inject a fake ChatFn — no API key needed for `npm run llm:test`.

import OpenAI from "openai";
import { z } from "zod";
import type { QuestionType } from "./types";

export type Difficulty = "easy" | "medium" | "hard";

/** Minimal chat interface — the seam where providers plug in. */
export type ChatFn = (
  system: string,
  user: string,
  opts?: { json?: boolean },
) => Promise<string>;

function chatModel(): string {
  return process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
}

/** Production provider: OpenAI chat (defaults to gpt-4o-mini). */
export function openAIChatFn(client?: OpenAI): ChatFn {
  const c = client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return async (system, user, opts) => {
    const res = await c.chat.completions.create({
      model: chatModel(),
      temperature: 0.3,
      ...(opts?.json ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    if (!text) throw new LlmError("empty response from model");
    return text;
  };
}

/** Resolve the chat function from LLM_PROVIDER (swappable seam). */
export function providerChatFn(name?: string): ChatFn {
  const provider = name ?? process.env.LLM_PROVIDER ?? "openai";
  if (provider === "openai") return openAIChatFn();
  if (provider === "ollama") return ollamaChatFn();
  throw new LlmError(`unknown LLM_PROVIDER: ${provider}`);
}

/** Ollama base URL (local server, no key). */
export function ollamaUrl(): string {
  return process.env.OLLAMA_URL ?? "http://localhost:11434";
}

/** Ollama chat model — pull first: `ollama pull llama3.1`. */
export function ollamaChatModel(): string {
  return process.env.OLLAMA_CHAT_MODEL ?? "llama3.1";
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Local provider: Ollama chat (free, no API key). Uses `format: "json"`
 * when JSON is requested. fetchFn is injectable for tests.
 */
export function ollamaChatFn(
  opts: { url?: string; model?: string; fetchFn?: FetchFn } = {},
): ChatFn {
  const url = opts.url ?? ollamaUrl();
  const model = opts.model ?? ollamaChatModel();
  const doFetch: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  return async (system, user, chatOpts) => {
    let res: Response;
    try {
      res = await doFetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          ...(chatOpts?.json ? { format: "json" } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (e) {
      throw new LlmError(
        `Ollama unreachable at ${url}. Run 'ollama serve'. (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    if (!res.ok) {
      throw new LlmError(
        `Ollama chat failed (${res.status}). Run: ollama pull ${model}`,
      );
    }
    const body = (await res.json()) as { message?: { content?: string } };
    const text = body.message?.content ?? "";
    if (!text) throw new LlmError("empty response from Ollama model");
    return text;
  };
}

export class LlmError extends Error {}

/** Strip ``` fences models sometimes add around JSON. */
function cleanJson(raw: string): string {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return t.trim();
}

function parseJson<T>(raw: string, schema: z.ZodSchema<T>, what: string): T {
  let obj: unknown;
  try {
    obj = JSON.parse(cleanJson(raw));
  } catch {
    throw new LlmError(`unparseable JSON for ${what}: ${raw.slice(0, 200)}`);
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new LlmError(`invalid ${what}: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------- concepts

const ExtractedConceptSchema = z.object({
  name: z.string().min(1),
  source_excerpt: z.string().min(1),
});
const ExtractedConceptsSchema = z.object({
  concepts: z.array(ExtractedConceptSchema).min(1),
});

export type ExtractedConcept = z.infer<typeof ExtractedConceptSchema>;

/** Max chars sent in a single extraction call; longer notes use map-reduce. */
export const EXTRACT_SINGLE_BUDGET = 24_000;
const MAP_CHUNK = 6_000;

const EXTRACT_SYSTEM = `You extract the distinct testable concepts from lecture notes. Reply with a JSON object {"concepts": [{"name": ..., "source_excerpt": ...}]}. Each name is a short noun phrase (3-8 words). Each source_excerpt is a 1-2 sentence verbatim quote from the notes grounding that concept. Cover every major idea; 3-12 concepts. No duplicates, no commentary outside the JSON.`;

export async function extractConcepts(
  text: string,
  chat: ChatFn = providerChatFn(),
): Promise<ExtractedConcept[]> {
  if (text.length <= EXTRACT_SINGLE_BUDGET) {
    const raw = await chat(EXTRACT_SYSTEM, `LECTURE NOTES:\n${text}`, { json: true });
    return parseJson(raw, ExtractedConceptsSchema, "concepts").concepts;
  }
  // Map: extract per chunk, then reduce (dedupe/merge).
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += MAP_CHUNK) pieces.push(text.slice(i, i + MAP_CHUNK));
  const per = await Promise.all(
    pieces.map((p) => chat(EXTRACT_SYSTEM, `LECTURE NOTES (part):\n${p}`, { json: true })),
  );
  const merged = per.flatMap(
    (raw) => parseJson(raw, ExtractedConceptsSchema, "concepts").concepts,
  );
  const reduceRaw = await chat(
    `You merge concept lists. Reply with a JSON object {"concepts": [...]}. Merge near-duplicates (keep the clearest name, join excerpts), keep 3-15 concepts total.`,
    `CANDIDATE CONCEPTS:\n${JSON.stringify(merged)}`,
    { json: true },
  );
  return parseJson(reduceRaw, ExtractedConceptsSchema, "concepts").concepts;
}

// --------------------------------------------------------------- questions

const McqSchema = z.object({
  type: z.literal("mcq"),
  stem: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
});
const TrueFalseSchema = z.object({
  type: z.literal("true_false"),
  statement: z.string().min(1),
  answer: z.boolean(),
});
const ShortAnswerSchema = z.object({
  type: z.literal("short_answer"),
  stem: z.string().min(1),
  rubric: z.string().min(1),
  expectedAnswer: z.string().min(1),
});
export const QuestionSchema = z.discriminatedUnion("type", [
  McqSchema,
  TrueFalseSchema,
  ShortAnswerSchema,
]);
export type Question = z.infer<typeof QuestionSchema>;

const TYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  mcq: `Write ONE multiple-choice question as JSON {"type":"mcq","stem":...,"options":[exactly 4 strings],"correctIndex":0-3}. Distractors must be plausible and drawn from the context; exactly one option correct.`,
  true_false: `Write ONE true/false item as JSON {"type":"true_false","statement":...,"answer":true/false}. The statement must be unambiguously true or false given ONLY the context — no tricks requiring outside knowledge.`,
  short_answer: `Write ONE short-answer question as JSON {"type":"short_answer","stem":...,"rubric":...,"expectedAnswer":...}. The stem needs a 1-3 sentence answer. The rubric lists the 2-4 key points a correct answer must contain. expectedAnswer is a model answer of 1-3 sentences.`,
};

const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy: "Test direct recall of one fact stated in the context.",
  medium: "Test understanding: paraphrase, mechanism, or distinguishing two ideas.",
  hard: "Test application/explanation: why/how, cause and effect, or a small scenario resolved from the context.",
};

export async function generateQuestion(
  concept: string,
  context: string,
  type: QuestionType,
  difficulty: Difficulty,
  chat: ChatFn = providerChatFn(),
): Promise<Question> {
  const raw = await chat(
    `You write quiz questions strictly grounded in the provided context. Use ONLY facts entailed by the context; never import outside knowledge. Reply with a single JSON object, no commentary.`,
    `CONCEPT: ${concept}\nDIFFICULTY: ${difficulty} — ${DIFFICULTY_HINT[difficulty]}\nCONTEXT:\n${context}\n\n${TYPE_INSTRUCTIONS[type]}`,
    { json: true },
  );
  const q = parseJson(raw, QuestionSchema, "question");
  if (q.type !== type) throw new LlmError(`asked for ${type}, got ${q.type}`);
  return q;
}

// ----------------------------------------------------------------- grading

const GradeSchema = z.object({
  score: z.number().min(0).max(1),
  explanation: z.string().min(1).max(280),
});
export type Grade = z.infer<typeof GradeSchema>;

/**
 * Grade a short answer against the rubric + context. Returns 0.0-1.0 with
 * partial credit plus a one-line explanation. (MCQ / true-false are graded by
 * exact match with no LLM call — see scheduler/API.)
 */
export async function gradeAnswer(
  question: string,
  userAnswer: string,
  context: string,
  rubric: string,
  chat: ChatFn = providerChatFn(),
): Promise<Grade> {
  const raw = await chat(
    `You grade a student's short answer. Award partial credit: 1.0 all key points, ~0.5 half, 0.0 wrong or empty. Judge ONLY against the rubric and context. Reply with a single JSON object {"score": 0.0-1.0, "explanation": "one sentence"} — no commentary.`,
    `QUESTION: ${question}\nRUBRIC: ${rubric}\nCONTEXT:\n${context}\nSTUDENT ANSWER: ${userAnswer || "(blank)"}`,
    { json: true },
  );
  return parseJson(raw, GradeSchema, "grade");
}

// ----------------------------------------------------------------- reteach

/** Re-teach a concept from retrieved chunks (source for the re-teach screen). */
export async function reteach(
  concept: string,
  context: string,
  chat: ChatFn = providerChatFn(),
): Promise<string> {
  return chat(
    `You are a tutor re-teaching one concept the student got wrong. Explain clearly in 3-6 sentences using ONLY the context. End with one sentence on the likely misconception to avoid. Plain text, no JSON.`,
    `CONCEPT: ${concept}\nCONTEXT:\n${context}`,
  );
}
