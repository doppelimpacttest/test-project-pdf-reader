import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, "../../logs");

fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `llm-${y}-${m}-${d}.jsonl`);
}

export interface LlmLogEntry {
  timestamp: string;
  type: "llm-request" | "llm-response" | "llm-error";
  sessionId: string;
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
  pdfCharsSent: number;
  question: string;
  answer?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
  error?: string;
}

export interface ComparisonLogEntry {
  timestamp: string;
  type: "model-comparison";
  sessionId: string;
  question: string;
  modelA: string;
  modelB: string;
  answerA: string;
  answerB: string;
  intentChanged: boolean;
  divergenceType: string;
  confidence: number;
  reason: string;
  whichBetter: string;
  similarity?: number;
  intent1?: string;
  intent2?: string;
  detectionMethod: string;
  hybridPhase?: string;
  judgeReason?: string;
  judgeConfidence?: number;
  durationMs: number;
}

export interface IntentDetectionLogEntry {
  timestamp: string;
  type: "intent-detection";
  sessionId: string;
  detectionType: "answer-comparison" | "follow-up";
  intentChanged: boolean;
  similarity: number;
  intent1: string;
  intent2: string;
  threshold: number;
  durationMs: number;
}

export interface ToneComparisonLogEntry {
  timestamp: string;
  type: "tone-comparison";
  sessionId: string;
  question: string;
  modelA: string;
  modelB: string;
  answerA: string;
  answerB: string;
  politenessA: number;
  politenessB: number;
  politenessDelta: number;
  severity: "none" | "minor" | "medium" | "severe";
  regressions: string[];
  improvements: string[];
  durationMs: number;
}

export type LogEntry = LlmLogEntry | ComparisonLogEntry | IntentDetectionLogEntry | ToneComparisonLogEntry;

export function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFile(getLogFileName(), line, (err) => {
    if (err) {
      console.error("Failed to write log:", err);
    }
  });
}
