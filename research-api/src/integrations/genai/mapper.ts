import type {
  Evidence,
  ResearchResponse,
  ResearchSearchQuery,
} from "../../research/types.js";
import {
  parseResearchRequest,
  RequestValidationError,
} from "../../api/request.js";

type GenaiRequest = {
  inputs?: Record<string, unknown>;
};

function parseCommaSeparated(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string")) {
      throw new RequestValidationError("絞り込み項目の値が不正です。");
    }
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") {
    throw new RequestValidationError("絞り込み項目はカンマ区切りで指定してください。");
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function fromGenaiRequest(value: unknown): ResearchSearchQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestValidationError("inputs を含むJSONオブジェクトが必要です。");
  }
  const inputs = (value as GenaiRequest).inputs;
  if (!inputs || typeof inputs.question !== "string") {
    throw new RequestValidationError("inputs.question は必須です。");
  }
  const municipalities = parseCommaSeparated(inputs.municipalities);
  const fiscalYears = parseCommaSeparated(inputs.fiscal_years)
    ?.map((year) => Number(year));

  return parseResearchRequest({
    query: inputs.question,
    mode: inputs.mode ?? "research",
    sourceTypes: ["plenary_minutes"],
    ...(municipalities?.length ? { municipalities } : {}),
    ...(fiscalYears?.length ? { fiscalYears } : {}),
  });
}

function safeMarkdownText(value: string): string {
  return value
    .replace(/\[([^\]]*)\]\((?:https?:\/\/|\/)[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "[URL省略]")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]<>])/g, "\\$1");
}

function evidenceLinks(evidences: Evidence[], ids: string[]): string {
  const wanted = new Set(ids);
  return evidences
    .filter((evidence) => wanted.has(evidence.id))
    .map(
      (evidence) =>
        `[${safeMarkdownText(evidence.municipalityName)}・${safeMarkdownText(evidence.title)}](${evidence.sourceUrl})`,
    )
    .join("、");
}

export function toGenaiMarkdown(response: ResearchResponse): string {
  const { result } = response;
  const lines: string[] = ["## 調査概要", "", safeMarkdownText(result.summary)];

  if (result.keyIssues.length) {
    lines.push("", "## 主な論点", "");
    for (const item of result.keyIssues) {
      lines.push(
        `### ${safeMarkdownText(item.title)}`,
        "",
        safeMarkdownText(item.description),
        "",
        `根拠: ${evidenceLinks(result.evidences, item.evidenceIds) || "該当根拠なし"}`,
      );
    }
  }

  if (result.municipalityComparisons.length) {
    lines.push("", "## 自治体別", "");
    for (const item of result.municipalityComparisons) {
      lines.push(
        `### ${safeMarkdownText(item.municipalityName)}`,
        "",
        safeMarkdownText(item.summary),
      );
      lines.push(...item.points.map((point) => `- ${safeMarkdownText(point)}`));
      lines.push(
        "",
        `根拠: ${evidenceLinks(result.evidences, item.evidenceIds) || "該当根拠なし"}`,
      );
    }
  }

  if (result.administrationResponsePatterns.length) {
    lines.push("", "## 行政答弁の傾向", "");
    for (const item of result.administrationResponsePatterns) {
      lines.push(
        `- **${safeMarkdownText(item.pattern)}**: ${safeMarkdownText(item.description)}（${evidenceLinks(result.evidences, item.evidenceIds)}）`,
      );
    }
  }

  if (result.policyOptions.length) {
    lines.push("", "## 政策上の選択肢", "");
    for (const item of result.policyOptions) {
      lines.push(
        `- **${safeMarkdownText(item.title)}**: ${safeMarkdownText(item.description)}（${evidenceLinks(result.evidences, item.evidenceIds)}）`,
      );
    }
  }

  if (result.nextResearchItems.length) {
    lines.push("", "## 次に確認すべき事項", "");
    lines.push(
      ...result.nextResearchItems.map((item) => `- ${safeMarkdownText(item)}`),
    );
  }

  lines.push("", "## 根拠資料", "");
  lines.push(
    ...result.evidences.map(
      (evidence) =>
        `- [${safeMarkdownText(evidence.municipalityName)}・${safeMarkdownText(evidence.title)}](${evidence.sourceUrl}) — ${safeMarkdownText(evidence.excerpt)}`,
    ),
  );

  if (result.limitations.length) {
    lines.push("", "## 調査上の限界", "");
    lines.push(...result.limitations.map((item) => `- ${safeMarkdownText(item)}`));
  }

  lines.push("", `> ${safeMarkdownText(response.disclaimer)}`);
  return lines.join("\n");
}

export function toGenaiResponse(response: ResearchResponse): { outputs: string } {
  return { outputs: toGenaiMarkdown(response) };
}
