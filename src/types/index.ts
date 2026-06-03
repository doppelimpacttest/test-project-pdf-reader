export interface PdfParseResult {
  text: string;
  pageCount: number;
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

export interface ComparisonResult {
  enabled: boolean;
  modelA: string;
  modelB: string;
  answerA: string;
  answerB: string;
  intentChanged: boolean;
  divergenceType: "none" | "factual" | "scope" | "interpretation" | "hallucination";
  confidence: number;
  reason: string;
  whichBetter: "A" | "B" | "equal";
  similarity?: number;
  intent1?: string;
  intent2?: string;
  detectionMethod: "embedding" | "llm-judge" | "hybrid";
  hybridPhase?: string;
  judgeReason?: string;
  judgeConfidence?: number;
}

export interface DimensionScore {
  score: number;
  max: number;
  details: string[];
}

export interface PolitenessResult {
  respectfulness: DimensionScore;
  warmness: DimensionScore;
  professionalism: DimensionScore;
  contextSensitivity: DimensionScore;
  directnessPenalty: DimensionScore;
  totalScore: number;
  maxScore: number;
  normalizedScore: number;
  grade: "excellent" | "good" | "moderate" | "poor" | "robotic";
  summary: string;
}

export interface ToneRegression {
  politenessDelta: number;
  severity: "none" | "minor" | "medium" | "severe";
  regressions: string[];
  improvements: string[];
}

export interface PoliteComparisonResult {
  scoreA: PolitenessResult;
  scoreB: PolitenessResult;
  regression: ToneRegression;
  winner: "A" | "B" | "tie";
  intentMatch: boolean;
  similarity: number;
}

export interface AskResponse {
  answer: string;
  comparison?: ComparisonResult;
  followUpIntent?: FollowUpIntentResult | null;
}

export interface PoliteAskResponse {
  answer: string;
  answerA: string;
  answerB: string;
  politenessA: PolitenessResult;
  politenessB: PolitenessResult;
  comparison: PoliteComparisonResult;
}

export interface ApiError {
  error: string;
  details?: string;
}
