const RESPECTFUL_PHRASES: string[] = [
  "your", "please", "kindly", "as indicated", "as per", "as shown",
  "as mentioned", "as noted", "as detailed", "as specified",
  "thank you", "thanks", "appreciate", "grateful",
  "would you", "could you", "may i", "might i",
  "dear", "respectfully", "with respect",
  "i hope", "i trust", "glad to", "happy to",
  "please note", "please be advised", "please find",
  "as you may know", "as you are aware",
  "it is worth noting", "it should be noted",
  "if you have any questions", "please let me know",
  "do not hesitate", "feel free",
];

const WARMTH_PHRASES: string[] = [
  "thank you", "thanks", "appreciate", "grateful",
  "please", "kindly", "glad", "happy", "pleased",
  "hope", "wish", "warmly", "cheerfully",
  "great news", "congratulations", "well done",
  "i am happy", "i am glad", "i would be happy",
  "do let me", "feel free", "don't hesitate",
  "welcome", "delighted",
];

const PROFESSIONAL_PHRASES: string[] = [
  "as indicated", "as per", "as shown", "as detailed",
  "as specified", "as noted", "as mentioned",
  "according to", "based on", "with reference to",
  "in accordance with", "pursuant to",
  "please note", "please be advised", "please find enclosed",
  "it is important", "it should be noted", "it is worth",
  "furthermore", "moreover", "additionally",
  "therefore", "consequently", "accordingly",
  "in summary", "to summarize", "in conclusion",
  "for your reference", "for your information",
  "as per the document", "as per the record",
  "the document indicates", "the record shows",
];

const COMMAND_PATTERNS: RegExp[] = [
  /^(here is|here's)\b/i,
  /^(the|this is)\s+(your|the)\s+\w+\s+(is|are)$/i,
  /^\w+:\s*[\d,.]+$/i,
  /^amount:\s*/i,
  /^total:\s*/i,
  /^net:\s*/i,
  /^gross:\s*/i,
];

const FRAGMENT_PATTERNS: RegExp[] = [
  /^[\w\s]+:\s*[\d,.]+$/,
  /^(rs\.?|inr|₹)\s*[\d,.]+$/i,
  /^[\d,.]+\s*(rs\.?|inr|₹)$/i,
];

const OVERLY_EMOTIONAL_PATTERNS: RegExp[] = [
  /🎉/,
  /🔥/,
  /💯/,
  /❤️/,
  /😊/,
  /👍/,
  /!/,
  /wow/i,
  /amazing/i,
  /fantastic/i,
  /awesome/i,
  /incredible/i,
  /oh my/i,
  /yay/i,
];

interface DimensionScore {
  score: number;
  max: number;
  details: string[];
}

interface PolitenessResult {
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

function countMatches(text: string, phrases: string[]): { count: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      matched.push(phrase);
    }
  }
  return { count: matched.length, matched };
}

function hasPattern(text: string, patterns: RegExp[]): { found: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) matched.push(m[0]);
  }
  return { found: matched.length > 0, matched };
}

function scoreRespectfulness(text: string): DimensionScore {
  const { count, matched } = countMatches(text, RESPECTFUL_PHRASES);
  const hasSubject = /^(your|the|this|it|i|we)\b/i.test(text.trim());
  const hasPoliteCloser = /(let me know|please feel|do not hesitate|if you have)/i.test(text);

  let score = Math.min(count * 4, 20);
  if (hasSubject) score += 3;
  if (hasPoliteCloser) score += 2;
  score = Math.min(score, 25);

  return { score, max: 25, details: matched };
}

function scoreWarmness(text: string): DimensionScore {
  const { count, matched } = countMatches(text, WARMTH_PHRASES);
  let score = Math.min(count * 5, 20);
  score = Math.min(score, 20);

  return { score, max: 20, details: matched };
}

function scoreProfessionalism(text: string): DimensionScore {
  const { count, matched } = countMatches(text, PROFESSIONAL_PHRASES);
  const wordCount = text.split(/\s+/).length;
  const hasFullSentence = /[.!?]$/.test(text.trim()) && wordCount >= 6;
  const hasContextRef = /(pay slip|payslip|document|record|statement)/i.test(text);

  let score = Math.min(count * 4, 12);
  if (hasFullSentence) score += 4;
  if (hasContextRef) score += 4;
  score = Math.min(score, 20);

  return { score, max: 20, details: matched };
}

function scoreContextSensitivity(text: string, domain: string): DimensionScore {
  const { found: isOverlyEmotional } = hasPattern(text, OVERLY_EMOTIONAL_PATTERNS);
  const wordCount = text.split(/\s+/).length;
  const isNeutral = !isOverlyEmotional && wordCount >= 4;
  const hasDomainRef = /(pay|salary|deduction|amount|document|slip|month)/i.test(text);

  let score = 10;
  if (isNeutral) score += 5;
  if (hasDomainRef) score += 5;
  if (isOverlyEmotional) score -= 10;
  score = Math.max(0, Math.min(score, 20));

  const details: string[] = [];
  if (isOverlyEmotional) details.push("overly emotional for domain");
  if (isNeutral) details.push("neutral tone");
  if (hasDomainRef) details.push("domain-appropriate reference");

  return { score, max: 20, details };
}

function scoreDirectness(text: string): DimensionScore {
  const { found: isCommand } = hasPattern(text, COMMAND_PATTERNS);
  const { found: isFragment } = hasPattern(text, FRAGMENT_PATTERNS);
  const wordCount = text.split(/\s+/).length;
  const isShort = wordCount <= 5;

  let penalty = 0;
  if (isCommand) penalty += 8;
  if (isFragment) penalty += 10;
  if (isShort) penalty += 5;
  penalty = Math.min(penalty, 15);

  const details: string[] = [];
  if (isCommand) details.push("command-style opening");
  if (isFragment) details.push("sentence fragment");
  if (isShort) details.push("too brief");

  return { score: penalty, max: 15, details };
}

function getGrade(normalized: number): PolitenessResult["grade"] {
  if (normalized >= 85) return "excellent";
  if (normalized >= 70) return "good";
  if (normalized >= 50) return "moderate";
  if (normalized >= 30) return "poor";
  return "robotic";
}

function generateSummary(r: PolitenessResult): string {
  const parts: string[] = [];
  if (r.respectfulness.score >= 20) parts.push("highly respectful");
  else if (r.respectfulness.score >= 12) parts.push("respectful");
  else parts.push("lacks courtesy markers");

  if (r.professionalism.score >= 16) parts.push("professional tone");
  else if (r.professionalism.score >= 10) parts.push("moderately professional");
  else parts.push("informal tone");

  if (r.warmness.score >= 12) parts.push("warm");
  else if (r.warmness.score >= 6) parts.push("neutral warmth");
  else parts.push("transactional/cold");

  if (r.directnessPenalty.score >= 8) parts.push("overly direct/abrupt");
  else if (r.directnessPenalty.score >= 4) parts.push("slightly abrupt");

  return parts.join(", ");
}

export function scorePoliteness(text: string, domain: string = "payslip"): PolitenessResult {
  const respectfulness = scoreRespectfulness(text);
  const warmness = scoreWarmness(text);
  const professionalism = scoreProfessionalism(text);
  const contextSensitivity = scoreContextSensitivity(text, domain);
  const directnessPenalty = scoreDirectness(text);

  const maxScore = 25 + 20 + 20 + 20;
  const rawTotal = respectfulness.score + warmness.score + professionalism.score + contextSensitivity.score;
  const totalScore = Math.max(0, rawTotal - directnessPenalty.score);
  const normalizedScore = Math.round((totalScore / maxScore) * 100);

  const result: PolitenessResult = {
    respectfulness,
    warmness,
    professionalism,
    contextSensitivity,
    directnessPenalty,
    totalScore,
    maxScore,
    normalizedScore,
    grade: getGrade(normalizedScore),
    summary: "",
  };

  result.summary = generateSummary(result);
  return result;
}

export interface ToneRegression {
  politenessDelta: number;
  severity: "none" | "minor" | "medium" | "severe";
  regressions: string[];
  improvements: string[];
}

export function detectToneRegression(
  scoreA: PolitenessResult,
  scoreB: PolitenessResult
): ToneRegression {
  const politenessDelta = scoreB.normalizedScore - scoreA.normalizedScore;
  const absDelta = Math.abs(politenessDelta);

  let severity: ToneRegression["severity"] = "none";
  if (absDelta > 30) severity = "severe";
  else if (absDelta > 15) severity = "medium";
  else if (absDelta > 5) severity = "minor";

  const regressions: string[] = [];
  const improvements: string[] = [];

  const dims = [
    { name: "respectfulness", a: scoreA.respectfulness.score, b: scoreB.respectfulness.score, max: 25 },
    { name: "warmness", a: scoreA.warmness.score, b: scoreB.warmness.score, max: 20 },
    { name: "professionalism", a: scoreA.professionalism.score, b: scoreB.professionalism.score, max: 20 },
    { name: "context sensitivity", a: scoreA.contextSensitivity.score, b: scoreB.contextSensitivity.score, max: 20 },
    { name: "directness", a: scoreA.directnessPenalty.score, b: scoreB.directnessPenalty.score, max: 15, inverted: true },
  ];

  for (const d of dims) {
    const diff = d.b - d.a;
    const pctChange = d.max > 0 ? Math.abs(diff) / d.max : 0;
    if (pctChange < 0.1) continue;

    const isInverted = "inverted" in d && d.inverted;
    const gotWorse = isInverted ? diff > 0 : diff < 0;
    const gotBetter = isInverted ? diff < 0 : diff > 0;

    if (gotWorse) {
      regressions.push(`${d.name}: ${d.a} → ${d.b} (${diff > 0 ? "+" : ""}${diff})`);
    } else if (gotBetter) {
      improvements.push(`${d.name}: ${d.a} → ${d.b} (+${diff})`);
    }
  }

  return { politenessDelta, severity, regressions, improvements };
}

export interface PoliteComparisonResult {
  scoreA: PolitenessResult;
  scoreB: PolitenessResult;
  regression: ToneRegression;
  winner: "A" | "B" | "tie";
  intentMatch: boolean;
  similarity: number;
}
