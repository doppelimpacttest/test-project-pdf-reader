import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractTextFromPdf } from "../services/pdfParser.js";
import { askQuestion } from "../services/llm.js";
import { compareModels, buildComparisonResult } from "../services/comparator.js";
import { detectFollowUpIntent } from "../services/intentDetector.js";
import { writeLog } from "../services/logger.js";
import { scorePoliteness, detectToneRegression } from "../services/politeness.js";
import type { ApiError, AskResponse, AnswerIntentResult, PoliteAskResponse } from "../types/index.js";

const pdfStore = new Map<string, string>();
const lastQuestionStore = new Map<string, string>();
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB ?? "10", 10)) * 1024 * 1024;
const MAX_PAGES = parseInt(process.env.MAX_PDF_PAGES ?? "100", 10);
const LOG_DIR = path.resolve(process.cwd(), "logs");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "change-me-in-production";

export async function registerRoutes(server: any): Promise<void> {

  server.get("/api/health", async () => ({ status: "ok" }));

  server.post(
    "/api/upload",
    async (
      request: any,
      reply: any
    ): Promise<{ sessionId: string; pageCount: number; charCount: number } | ApiError> => {
      const data = await request.file() as any;

      if (!data) {
        reply.code(400);
        return { error: "No file uploaded", details: "Send a PDF file with key 'file'" };
      }

      const mimeType = data.mimetype ?? data.file?.type;
      if (mimeType !== "application/pdf") {
        reply.code(400);
        return { error: "Invalid file type", details: "Only PDF files are accepted" };
      }

      const buffer = await data.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        reply.code(413);
        return {
          error: "File too large",
          details: `Maximum file size is ${process.env.MAX_FILE_SIZE_MB ?? "10"} MB`,
        };
      }

      const { text, pageCount } = await extractTextFromPdf(buffer);

      if (pageCount > MAX_PAGES) {
        reply.code(413);
        return {
          error: "PDF too long",
          details: `Maximum ${MAX_PAGES} pages, got ${pageCount}`,
        };
      }

      const sessionId = crypto.randomUUID();
      pdfStore.set(sessionId, text);

      return { sessionId, pageCount, charCount: text.length };
    }
  );

  server.post(
    "/api/ask",
    async (request: any, reply: any): Promise<AskResponse | ApiError> => {
      const {
        sessionId,
        question,
        model,
        compareModel,
        compareMode,
        detectionMethod,
      } = request.body as {
        sessionId?: string;
        question?: string;
        model?: string;
        compareModel?: string;
        compareMode?: boolean;
        detectionMethod?: "embedding" | "llm-judge" | "hybrid";
      };

      if (!sessionId || !pdfStore.has(sessionId)) {
        reply.code(400);
        return { error: "Invalid or expired session", details: "Upload a PDF first" };
      }

      if (!question || question.trim().length === 0) {
        reply.code(400);
        return { error: "Question is required" };
      }

      const pdfText = pdfStore.get(sessionId)!;
      const trimmedQuestion = question.trim();
      const method = detectionMethod ?? "embedding";
      const previousQuestion = lastQuestionStore.get(sessionId) ?? undefined;

      let followUpIntent: AskResponse["followUpIntent"];
      const followUpStarted = Date.now();
      if (previousQuestion) {
        followUpIntent = await detectFollowUpIntent(trimmedQuestion, previousQuestion);
        if (followUpIntent) {
          writeLog({
            timestamp: new Date().toISOString(),
            type: "intent-detection",
            sessionId,
            detectionType: "follow-up",
            intentChanged: followUpIntent.intentChanged,
            similarity: followUpIntent.similarity,
            intent1: followUpIntent.previousIntent,
            intent2: followUpIntent.currentIntent,
            threshold: followUpIntent.threshold,
            durationMs: Date.now() - followUpStarted,
          });
        }
      } else {
        followUpIntent = null;
      }
      lastQuestionStore.set(sessionId, trimmedQuestion);

      if (compareMode && compareModel) {
        const startedAt = Date.now();
        const { answerA, answerB, intentResult, judge } = await compareModels(
          pdfText,
          trimmedQuestion,
          model ?? "gpt-4o-mini",
          compareModel,
          method
        );
        const durationMs = Date.now() - startedAt;

        writeLog({
          timestamp: new Date().toISOString(),
          type: "model-comparison",
          sessionId,
          question: trimmedQuestion,
          modelA: model ?? "gpt-4o-mini",
          modelB: compareModel,
          answerA,
          answerB,
          intentChanged: intentResult.intentChanged,
          divergenceType: judge?.divergence_type ?? "none",
          confidence: intentResult.confidence,
          reason: judge?.reason ?? `Intent similarity: ${intentResult.similarity}`,
          whichBetter: judge?.which_better ?? "equal",
          similarity: intentResult.similarity,
          intent1: intentResult.intent1,
          intent2: intentResult.intent2,
          detectionMethod: method,
          hybridPhase: method === "hybrid" ? (intentResult as any).phase : undefined,
          judgeReason: method === "hybrid" ? (intentResult as any).judgeReason : judge?.reason,
          judgeConfidence: method === "hybrid" ? (intentResult as any).judgeConfidence : judge?.confidence,
          durationMs,
        });

        if (followUpIntent) {
          writeLog({
            timestamp: new Date().toISOString(),
            type: "intent-detection",
            sessionId,
            detectionType: "answer-comparison",
            intentChanged: intentResult.intentChanged,
            similarity: intentResult.similarity,
            intent1: intentResult.intent1,
            intent2: intentResult.intent2,
            threshold: method === "hybrid" ? ((intentResult as any).thresholds?.high ?? 0.90) : (intentResult as AnswerIntentResult).threshold,
            durationMs: 0,
          });
        }

        const comparison = buildComparisonResult(
          model ?? "gpt-4o-mini",
          compareModel,
          answerA,
          answerB,
          intentResult,
          judge,
          method
        );

        return { answer: answerA, comparison, followUpIntent };
      }

      const { answer } = await askQuestion(pdfText, trimmedQuestion, sessionId, model);
      return { answer, followUpIntent };
    }
  );

  server.post(
    "/api/ask/polite",
    async (request: any, reply: any): Promise<PoliteAskResponse | ApiError> => {
      const {
        sessionId,
        question,
        model,
        compareModel,
        detectionMethod,
      } = request.body as {
        sessionId?: string;
        question?: string;
        model?: string;
        compareModel?: string;
        detectionMethod?: "embedding" | "llm-judge" | "hybrid";
      };

      if (!sessionId || !pdfStore.has(sessionId)) {
        reply.code(400);
        return { error: "Invalid or expired session", details: "Upload a PDF first" };
      }

      if (!question || question.trim().length === 0) {
        reply.code(400);
        return { error: "Question is required" };
      }

      const pdfText = pdfStore.get(sessionId)!;
      const trimmedQuestion = question.trim();
      const method = detectionMethod ?? "hybrid";

      const startedAt = Date.now();
      const { answerA, answerB, intentResult, judge } = await compareModels(
        pdfText,
        trimmedQuestion,
        model ?? "gpt-4o-mini",
        compareModel ?? "gpt-4o-mini",
        method
      );
      const durationMs = Date.now() - startedAt;

      const scoreA = scorePoliteness(answerA, "payslip");
      const scoreB = scorePoliteness(answerB, "payslip");
      const regression = detectToneRegression(scoreA, scoreB);

      writeLog({
        timestamp: new Date().toISOString(),
        type: "tone-comparison",
        sessionId,
        question: trimmedQuestion,
        modelA: model ?? "gpt-4o-mini",
        modelB: compareModel ?? "gpt-4o-mini",
        answerA,
        answerB,
        politenessA: scoreA.normalizedScore,
        politenessB: scoreB.normalizedScore,
        politenessDelta: regression.politenessDelta,
        severity: regression.severity,
        regressions: regression.regressions,
        improvements: regression.improvements,
        durationMs,
      });

      const comparison: PoliteAskResponse["comparison"] = {
        scoreA,
        scoreB,
        regression,
        winner: regression.politenessDelta > 0 ? "B" : regression.politenessDelta < 0 ? "A" : "tie",
        intentMatch: intentResult.intentChanged === false,
        similarity: intentResult.similarity,
      };

      return {
        answer: answerA,
        answerA,
        answerB,
        politenessA: scoreA,
        politenessB: scoreB,
        comparison,
      };
    }
  );

  server.delete(
    "/api/session/:sessionId",
    async (request: any, reply: any): Promise<{ deleted: boolean }> => {
      const { sessionId } = request.params as { sessionId: string };
      const deleted = pdfStore.delete(sessionId);
      lastQuestionStore.delete(sessionId);
      if (!deleted) {
        reply.code(404);
      }
      return { deleted };
    }
  );

  server.get(
    "/api/admin/logs",
    async (request: any, reply: any): Promise<{ entries: string[]; file: string } | ApiError> => {
      const providedKey = (request.headers["x-admin-api-key"] ?? request.query?.key) as string | undefined;
      if (providedKey !== ADMIN_API_KEY) {
        reply.code(401);
        return { error: "Unauthorized", details: "Provide x-admin-api-key header or ?key= query param" };
      }

      const { date } = request.query as { date?: string };
      const dateParam = date ?? new Date().toISOString().slice(0, 10);
      const fileName = `llm-${dateParam}.jsonl`;
      const filePath = path.join(LOG_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        reply.code(404);
        return { error: "No logs found", details: fileName };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const entries = content.split("\n").filter(Boolean);

      return { entries, file: fileName };
    }
  );

  server.get(
    "/api/admin/logs/files",
    async (request: any, reply: any): Promise<{ files: string[] } | ApiError> => {
      const providedKey = (request.headers["x-admin-api-key"] ?? request.query?.key) as string | undefined;
      if (providedKey !== ADMIN_API_KEY) {
        reply.code(401);
        return { error: "Unauthorized" };
      }

      if (!fs.existsSync(LOG_DIR)) {
        return { files: [] };
      }

      const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl")).sort().reverse();
      return { files };
    }
  );

  server.addHook("onClose", () => {
    pdfStore.clear();
    lastQuestionStore.clear();
  });
}
