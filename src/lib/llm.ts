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
  // 1-2 sentences teaching WHY the answer is right, grounded in context.
  explanation: z.string().min(1).max(400),
});
const TrueFalseSchema = z.object({
  type: z.literal("true_false"),
  statement: z.string().min(1),
  answer: z.boolean(),
  // 1-2 sentences teaching WHY, grounded in context.
  explanation: z.string().min(1).max(400),
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
  mcq: `Write ONE multiple-choice question as JSON {"type":"mcq","stem":...,"options":[exactly 4 strings],"correctIndex":0-3,"explanation":...}. Distractors must be plausible and drawn from the context; exactly one option correct. The explanation teaches WHY the correct option is right in 1-2 sentences, using only the context.`,
  true_false: `Write ONE true/false item as JSON {"type":"true_false","statement":...,"answer":true/false,"explanation":...}. The statement must be unambiguously true or false given ONLY the context, no tricks requiring outside knowledge. The explanation teaches WHY in 1-2 sentences, using only the context.`,
  short_answer: `Write ONE short-answer question as JSON {"type":"short_answer","stem":...,"rubric":...,"expectedAnswer":...}. The stem needs a 1-3 sentence answer. The rubric lists the 2-4 key points a correct answer must contain. expectedAnswer is a model answer of 1-3 sentences.`,
};

const STYLE_RULE = `Use plain ASCII text only. No em dashes. No markdown formatting.`;

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
  const system = `You write quiz questions strictly grounded in the provided context. Use ONLY facts entailed by the context; never import outside knowledge. ${STYLE_RULE} Reply with a single JSON object, no commentary.`;
  const user = `CONCEPT: ${concept}\nDIFFICULTY: ${difficulty} - ${DIFFICULTY_HINT[difficulty]}\nCONTEXT:\n${context}\n\n${TYPE_INSTRUCTIONS[type]}`;
  const raw = await chat(system, user, { json: true });
  try {
    const q = parseJson(raw, QuestionSchema, "question");
    if (q.type !== type) throw new LlmError(`asked for ${type}, got ${q.type}`);
    return q;
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    // Small local models sometimes drop a field. One repair attempt.
    const retry = await chat(
      system,
      `${user}\n\nYour last reply was invalid: ${e.message}. Reply again with the corrected single JSON object containing ALL required fields.`,
      { json: true },
    );
    const q = parseJson(retry, QuestionSchema, "question");
    if (q.type !== type) throw new LlmError(`asked for ${type}, got ${q.type}`);
    return q;
  }
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
    `You are a tutor re-teaching one concept the student got wrong. Explain clearly in 3-6 sentences using ONLY the context. End with one sentence on the likely misconception to avoid. ${STYLE_RULE} Plain text, no JSON.`,
    `CONCEPT: ${concept}\nCONTEXT:\n${context}`,
  );
}

// ------------------------------------------------------------------- guide

const GuideItemSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1).max(1200),
  keyPoints: z.array(z.string().min(1)).min(2).max(4),
});
const GuideSchema = z.object({ items: z.array(GuideItemSchema).min(1) });
export type GuideItem = z.infer<typeof GuideItemSchema>;

/** Full notes small enough for one guide call (else per-concept fallback). */
export const GUIDE_SINGLE_BUDGET = 12_000;

/**
 * Teach-first study guide: one plain-language summary + 2-4 key points per
 * concept, grounded in the notes. Single call when the text fits, otherwise
 * one call per concept over retrieved context. Returns items in any order;
 * callers match by name.
 */
export async function buildGuide(
  fullText: string,
  conceptNames: string[],
  contextFor: (name: string) => Promise<string>,
  chat: ChatFn = providerChatFn(),
): Promise<GuideItem[]> {
  const system = `You teach from lecture notes. For EACH concept: a plain-language summary (3-5 sentences, no jargon without explaining it) and 2-4 key points (short phrases). Use ONLY the notes. ${STYLE_RULE} Reply with a single JSON object {"items": [{"name": <exact concept name>, "summary": ..., "keyPoints": [...]}]}, no commentary.`;
  if (fullText.length > 0 && fullText.length <= GUIDE_SINGLE_BUDGET) {
    const raw = await chat(
      system,
      `CONCEPTS:\n${conceptNames.join("\n")}\n\nNOTES:\n${fullText}`,
      { json: true },
    );
    return parseJson(raw, GuideSchema, "guide").items;
  }
  const out: GuideItem[] = [];
  for (const name of conceptNames) {
    const raw = await chat(
      system,
      `CONCEPTS:\n${name}\n\nNOTES:\n${await contextFor(name)}`,
      { json: true },
    );
    out.push(...parseJson(raw, GuideSchema, "guide").items);
  }
  return out;
}
