import type { ChatCompletion } from "openai/resources/chat/completions.js";
import { writeLog } from "./logger.js";
import type { AskResponse } from "../types/index.js";
import { getOpenAI } from "../lib/openaiClient.js";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 100_000;
const TEMPERATURE = 0.1;

export async function askQuestion(
  pdfText: string,
  question: string,
  sessionId: string,
  model?: string
): Promise<AskResponse> {
  const resolvedModel = model ?? MODEL;
  const truncatedText =
    pdfText.length > MAX_CONTEXT_CHARS
      ? pdfText.slice(0, MAX_CONTEXT_CHARS) +
        "\n\n[Content truncated due to length limits]"
      : pdfText;

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a helpful assistant that answers questions about PDF documents. " +
        "Base your answers strictly on the provided document content. " +
        "If the answer is not in the document, say so clearly.",
    },
    {
      role: "user" as const,
      content: `Document content:\n\n${truncatedText}\n\n---\n\nQuestion: ${question}`,
    },
  ];

  const pdfCharsSent = truncatedText.length;
  const startedAt = Date.now();

  writeLog({
    timestamp: new Date().toISOString(),
    type: "llm-request",
    sessionId,
    model: resolvedModel,
    temperature: TEMPERATURE,
    messages,
    pdfCharsSent,
    question,
    durationMs: 0,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (getOpenAI().chat.completions.create as any)({
      model: resolvedModel,
      messages,
      temperature: TEMPERATURE,
      _impactMeta: { sessionId, question, pdfCharsSent },
    }) as ChatCompletion;

    const durationMs = Date.now() - startedAt;
    const answer = response.choices[0]?.message?.content ?? "No answer generated.";

    writeLog({
      timestamp: new Date().toISOString(),
      type: "llm-response",
      sessionId,
      model: resolvedModel,
      temperature: TEMPERATURE,
      messages,
      pdfCharsSent,
      question,
      answer,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      durationMs,
    });

    return { answer };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);

    writeLog({
      timestamp: new Date().toISOString(),
      type: "llm-error",
      sessionId,
      model: resolvedModel,
      temperature: TEMPERATURE,
      messages,
      pdfCharsSent,
      question,
      error: errorMessage,
      durationMs,
    });

    throw err;
  }
}
