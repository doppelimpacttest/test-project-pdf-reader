import { detectAnswerIntent, detectHybridIntent } from "./intentDetector.js";
import type { ComparisonResult, AnswerIntentResult, HybridIntentResult } from "../types/index.js";
import { getOpenAI } from "../lib/openaiClient.js";

const JUDGE_MODEL = process.env.COMPARE_JUDGE_MODEL ?? "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 100_000;

interface JudgeResponse {
  intent_changed: boolean;
  divergence_type: "none" | "factual" | "scope" | "interpretation" | "hallucination";
  confidence: number;
  reason: string;
  which_better: "A" | "B" | "equal";
}

function buildUserMessage(pdfText: string, question: string): string {
  const truncated =
    pdfText.length > MAX_CONTEXT_CHARS
      ? pdfText.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated]"
      : pdfText;
  return `Document content:\n\n${truncated}\n\n---\n\nQuestion: ${question}`;
}

async function callSingleModel(
  model: string,
  pdfText: string,
  question: string,
  systemPrompt: string
): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserMessage(pdfText, question) },
    ],
    temperature: 0.1,
  });
  return response.choices[0]?.message?.content ?? "No answer generated.";
}

async function callJudge(
  pdfText: string,
  question: string,
  answerA: string,
  answerB: string
): Promise<JudgeResponse> {
  const truncated =
    pdfText.length > MAX_CONTEXT_CHARS
      ? pdfText.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated]"
      : pdfText;

  const judgePrompt = `You are a response comparator for a PDF Q&A system.

Given:
- A user question about a PDF document
- The PDF document content
- Response A from Model 1
- Response B from Model 2

Determine if the two responses have a MEANINGFUL INTENT CHANGE — i.e., do they convey
different factual information or answer different implied questions?

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

Question: ${question}

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

const SYSTEM_PROMPT =
  "You are a helpful assistant that answers questions about PDF documents. " +
  "Base your answers strictly on the provided document content. " +
  "If the answer is not in the document, say so clearly.";

export type DetectionMethod = "embedding" | "llm-judge" | "hybrid";

export interface CompareResult {
  answerA: string;
  answerB: string;
  intentResult: AnswerIntentResult | HybridIntentResult;
  judge?: JudgeResponse;
}

export async function compareModels(
  pdfText: string,
  question: string,
  modelA: string,
  modelB: string,
  detectionMethod: DetectionMethod = "embedding"
): Promise<CompareResult> {
  const [answerA, answerB] = await Promise.all([
    callSingleModel(modelA, pdfText, question, SYSTEM_PROMPT),
    callSingleModel(modelB, pdfText, question, SYSTEM_PROMPT),
  ]);

  if (detectionMethod === "llm-judge") {
    const judge = await callJudge(pdfText, question, answerA, answerB);
    const intentResult: AnswerIntentResult = {
      intentChanged: judge.intent_changed,
      similarity: judge.confidence,
      intent1: judge.intent_changed ? "different" : "same",
      intent2: judge.intent_changed ? "different" : "same",
      threshold: 0.9,
      confidence: judge.confidence,
      detectionPhase: "llm-judge",
      judgeReason: judge.reason,
    };
    return { answerA, answerB, intentResult, judge };
  }

  if (detectionMethod === "hybrid") {
    const hybridResult = await detectHybridIntent(pdfText, answerA, answerB);
    return { answerA, answerB, intentResult: hybridResult };
  }

  const intentResult = await detectAnswerIntent(answerA, answerB);
  return { answerA, answerB, intentResult };
}

export function buildComparisonResult(
  modelA: string,
  modelB: string,
  answerA: string,
  answerB: string,
  intentResult: AnswerIntentResult | HybridIntentResult,
  judge: JudgeResponse | undefined,
  detectionMethod: DetectionMethod
): ComparisonResult {
  if (detectionMethod === "hybrid") {
    const h = intentResult as HybridIntentResult;
    return {
      enabled: true,
      modelA,
      modelB,
      answerA,
      answerB,
      intentChanged: h.intentChanged,
      divergenceType: "none",
      confidence: h.confidence,
      reason: h.judgeReason
        ? `[${h.phase}] ${h.judgeReason} (sim: ${h.similarity})`
        : `[${h.phase}] ${h.decision} — similarity: ${h.similarity}`,
      whichBetter: "equal",
      similarity: h.similarity,
      intent1: h.intent1,
      intent2: h.intent2,
      detectionMethod,
      hybridPhase: h.phase,
      judgeReason: h.judgeReason,
      judgeConfidence: h.judgeConfidence,
    };
  }

  const e = intentResult as AnswerIntentResult;
  return {
    enabled: true,
    modelA,
    modelB,
    answerA,
    answerB,
    intentChanged: e.intentChanged,
    divergenceType: judge?.divergence_type ?? "none",
    confidence: e.confidence,
    reason: judge?.reason ?? (e.intentChanged
      ? `Intent changed: ${e.intent1} → ${e.intent2} (similarity: ${e.similarity})`
      : `Same intent: ${e.intent1} (similarity: ${e.similarity})`),
    whichBetter: judge?.which_better ?? "equal",
    similarity: e.similarity,
    intent1: e.intent1,
    intent2: e.intent2,
    detectionMethod,
    judgeReason: judge?.reason,
    judgeConfidence: judge?.confidence,
  };
}
