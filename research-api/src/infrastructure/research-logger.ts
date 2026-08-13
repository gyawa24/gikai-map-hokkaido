import { createHash } from "node:crypto";

export interface ResearchLogEvent {
  requestId: string;
  route: "research" | "genai";
  statusCode: number;
  durationMs: number;
  queryHash?: string;
  searchResultCount?: number;
  evidenceCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  aiStatus?: "completed" | "fallback" | "disabled";
  errorCode?: string;
}

export function hashQuestion(question: string): string {
  return createHash("sha256")
    .update(question.normalize("NFKC").trim())
    .digest("hex")
    .slice(0, 16);
}

export function writeResearchLog(event: ResearchLogEvent): void {
  // Intentionally exclude raw questions, evidence text and generated answers.
  process.stdout.write(`${JSON.stringify({ event: "policy_research", ...event })}\n`);
}
