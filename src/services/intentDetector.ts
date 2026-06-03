import { getOpenAI } from "../lib/openaiClient.js";

const EMBEDDING_MODEL = process.env.INTENT_EMBEDDING_MODEL ?? "text-embedding-3-small";
const THRESHOLD = parseFloat(process.env.INTENT_EMBEDDING_THRESHOLD ?? "0.90");
const HYBRID_LOW = parseFloat(process.env.HYBRID_THRESHOLD_LOW ?? "0.75");
const HYBRID_HIGH = parseFloat(process.env.HYBRID_THRESHOLD_HIGH ?? "0.90");
const JUDGE_MODEL = process.env.COMPARE_JUDGE_MODEL ?? "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 100_000;

const INTENT_CATEGORIES: Record<string, string[]> = {
  salary_information: [
    "salary", "basic", "hra", "house rent", "allowance", "earnings",
    "pay", "wage", "stipend", "remuneration", "compensation",
  ],
  deductions: [
    "deduction", "pf", "provident fund", "professional tax", "income tax",
    "esi", "tds", "tax", "cut", "subtract",
  ],
  net_pay: [
    "net pay", "take home", "in-hand", "in hand", "net salary",
    "ctc", "cost to company", "total pay", "final pay",
  ],
  employment_info: [
    "joining", "date of join", "designation", "department", "employee id",
    "emp no", "empno", "emp id", "employee number", "role", "position",
    "reporting", "manager", "team",
  ],
  personal_details: [
    "name", "pan", "bank", "account", "address", "dob", "date of birth",
    "gender", "phone", "email", "nominee", "father", "mother",
  ],
  document_info: [
    "document", "page", "pay slip", "payslip", "date", "month", "year",
    "period", "issue", "generated",
  ],
};

function getEmbedding(text: string): Promise<number[]> {
  return getOpenAI().embeddings
    .create({ model: EMBEDDING_MODEL, input: text })
    .then((res) => res.data[0].embedding);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function classifyIntent(text: string): string {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(INTENT_CATEGORIES)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }
  return "other";
}

interface JudgeResponse {
  intent_changed: boolean;
  divergence_type: "none" | "factual" | "scope" | "interpretation" | "hallucination";
  confidence: number;
  reason: string;
  which_better: "A" | "B" | "equal";
}

async function callJudge(
  pdfText: string,
  answerA: string,
  answerB: string
): Promise<JudgeResponse> {
  const truncated =
    pdfText.length > MAX_CONTEXT_CHARS
      ? pdfText.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated]"
      : pdfText;

  const judgePrompt = `You are a response comparator for a PDF Q&A system.

Given the PDF document content and two different model responses, determine if the responses
have a MEANINGFUL INTENT CHANGE — i.e., do they convey different factual information or
answer different implied questions?

Check for:
1. Factual divergence: different numbers, dates, names
2. Scope divergence: one is broader/narrower than the other
3. Interpretation divergence: same data but different conclusions
4. Hallucination: one response includes info not in the document

Return ONLY valid JSON (no markdown, no code blocks):
{
  "intent_changed": true or false,
  "divergence_type": "none" or "factual" or "scope" or "interpretation" or "hallucination",
  "confidence": a number from 0.0 to 1.0,
  "reason": "one sentence explanation",
  "which_better": "A" or "B" or "equal"
}

PDF Document:
${truncated}

---

Response A:
${answerA}

---

Response B:
${answerB}`;

  const response = await getOpenAI().chat.completions.create({
    model: JUDGE_MODEL,
    messages: [{ role: "user", content: judgePrompt }],
    temperature: 0.0,
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned) as JudgeResponse;
  } catch {
    return {
      intent_changed: false,
      divergence_type: "none",
      confidence: 0.0,
      reason: "Failed to parse judge response.",
      which_better: "equal",
    };
  }
}

export interface AnswerIntentResult {
  intentChanged: boolean;
  similarity: number;
  intent1: string;
  intent2: string;
  threshold: number;
  confidence: number;
  detectionPhase?: "embedding" | "llm-judge";
  judgeReason?: string;
}

export interface HybridIntentResult {
  intentChanged: boolean;
  similarity: number;
  intent1: string;
  intent2: string;
  confidence: number;
  phase: "embedding-only" | "embedding-then-judge";
  decision: "same" | "changed" | "uncertain";
  judgeReason?: string;
  judgeConfidence?: number;
  thresholds: { low: number; high: number };
}

export interface FollowUpIntentResult {
  intentChanged: boolean;
  similarity: number;
  previousIntent: string;
  currentIntent: string;
  previousQuestion: string;
  currentQuestion: string;
  threshold: number;
  confidence: number;
}

export async function detectAnswerIntent(
  answerA: string,
  answerB: string,
  customThreshold?: number
): Promise<AnswerIntentResult> {
  const threshold = customThreshold ?? THRESHOLD;
  const [vecA, vecB] = await Promise.all([
    getEmbedding(answerA),
    getEmbedding(answerB),
  ]);
  const similarity = cosineSimilarity(vecA, vecB);
  const intent1 = classifyIntent(answerA);
  const intent2 = classifyIntent(answerB);
  const intentChanged = similarity < threshold;

  return {
    intentChanged,
    similarity: Math.round(similarity * 10000) / 10000,
    intent1,
    intent2,
    threshold,
    confidence: Math.round(similarity * 10000) / 10000,
    detectionPhase: "embedding",
  };
}

export async function detectHybridIntent(
  pdfText: string,
  answerA: string,
  answerB: string,
  customLow?: number,
  customHigh?: number
): Promise<HybridIntentResult> {
  const low = customLow ?? HYBRID_LOW;
  const high = customHigh ?? HYBRID_HIGH;

  const [vecA, vecB] = await Promise.all([
    getEmbedding(answerA),
    getEmbedding(answerB),
  ]);
  const similarity = cosineSimilarity(vecA, vecB);
  const intent1 = classifyIntent(answerA);
  const intent2 = classifyIntent(answerB);
  const rounded = Math.round(similarity * 10000) / 10000;

  if (rounded >= high) {
    return {
      intentChanged: false,
      similarity: rounded,
      intent1,
      intent2,
      confidence: rounded,
      phase: "embedding-only",
      decision: "same",
      thresholds: { low, high },
    };
  }

  if (rounded < low) {
    return {
      intentChanged: true,
      similarity: rounded,
      intent1,
      intent2,
      confidence: 1 - rounded,
      phase: "embedding-only",
      decision: "changed",
      thresholds: { low, high },
    };
  }

  const judge = await callJudge(pdfText, answerA, answerB);

  return {
    intentChanged: judge.intent_changed,
    similarity: rounded,
    intent1,
    intent2,
    confidence: judge.confidence,
    phase: "embedding-then-judge",
    decision: judge.intent_changed ? "changed" : "same",
    judgeReason: judge.reason,
    judgeConfidence: judge.confidence,
    thresholds: { low, high },
  };
}

export async function detectFollowUpIntent(
  currentQuestion: string,
  previousQuestion?: string,
  customThreshold?: number
): Promise<FollowUpIntentResult | null> {
  if (!previousQuestion) return null;
  const threshold = customThreshold ?? THRESHOLD;
  const [vecCurrent, vecPrevious] = await Promise.all([
    getEmbedding(currentQuestion),
    getEmbedding(previousQuestion),
  ]);
  const similarity = cosineSimilarity(vecCurrent, vecPrevious);
  const currentIntent = classifyIntent(currentQuestion);
  const previousIntent = classifyIntent(previousQuestion);
  const intentChanged = similarity < threshold;

  return {
    intentChanged,
    similarity: Math.round(similarity * 10000) / 10000,
    previousIntent,
    currentIntent,
    previousQuestion,
    currentQuestion,
    threshold,
    confidence: Math.round(similarity * 10000) / 10000,
  };
}
