import {
  SOURCE_TYPES,
  type ResearchMode,
  type ResearchSearchQuery,
  type SourceType,
} from "../research/types.js";

const MODES = new Set<ResearchMode>([
  "research",
  "comparison",
  "question_prep",
]);
const SOURCE_TYPE_SET = new Set<string>(SOURCE_TYPES);
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(
  value: unknown,
  field: string,
  maximumItems: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new RequestValidationError(`${field} は最大${maximumItems}件の配列で指定してください。`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string") {
      throw new RequestValidationError(`${field} の値が不正です。`);
    }
    return item.trim();
  });
  return [...new Set(result.filter(Boolean))];
}

function numberArray(
  value: unknown,
  field: string,
  maximumItems: number,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new RequestValidationError(`${field} は最大${maximumItems}件の配列で指定してください。`);
  }
  const result = value.map((item) => {
    if (!Number.isInteger(item) || Number(item) < 1900 || Number(item) > 2200) {
      throw new RequestValidationError(`${field} の年度が不正です。`);
    }
    return Number(item);
  });
  return [...new Set(result)];
}

export function parseResearchRequest(value: unknown): ResearchSearchQuery {
  if (!isRecord(value)) {
    throw new RequestValidationError("JSONオブジェクトを送信してください。");
  }
  if (typeof value.query !== "string") {
    throw new RequestValidationError("query は必須です。");
  }
  const query = value.query.trim();
  if (!query || query.length > 2000) {
    throw new RequestValidationError("query は1〜2000文字で指定してください。");
  }

  const municipalities = stringArray(value.municipalities, "municipalities", 180);
  if (municipalities?.some((slug) => !SLUG_PATTERN.test(slug))) {
    throw new RequestValidationError("municipalities には自治体slugを指定してください。");
  }

  const fiscalYears = numberArray(value.fiscalYears, "fiscalYears", 50);
  const requestedSourceTypes = stringArray(value.sourceTypes, "sourceTypes", SOURCE_TYPES.length);
  if (requestedSourceTypes?.some((item) => !SOURCE_TYPE_SET.has(item))) {
    throw new RequestValidationError("sourceTypes に未対応の値があります。");
  }

  const rawMode = value.mode ?? "research";
  if (typeof rawMode !== "string" || !MODES.has(rawMode as ResearchMode)) {
    throw new RequestValidationError("mode が不正です。");
  }

  const result: ResearchSearchQuery = { query, mode: rawMode as ResearchMode };
  if (municipalities?.length) result.municipalities = municipalities;
  if (fiscalYears?.length) result.fiscalYears = fiscalYears;
  if (requestedSourceTypes?.length) {
    result.sourceTypes = requestedSourceTypes as SourceType[];
  }
  return result;
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestValidationError("有効なJSONを送信してください。");
  }
}
