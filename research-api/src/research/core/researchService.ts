import { randomUUID } from "node:crypto";

import type { ResearchConfig } from "../../config.js";
import { validateCitations } from "../evidence/citationValidator.js";
import { buildEvidenceSet } from "../evidence/evidence.js";
import { generateRuleBasedSearchTerms } from "../query/searchTerms.js";
import { QueryRouter } from "../router/queryRouter.js";
import type {
  AnalysisSections,
  CitationValidationSummary,
  Evidence,
  PolicySourceDocument,
  ResearchAnalyzer,
  ResearchResponse,
  ResearchSearchQuery,
  SourceType,
  TokenUsage,
} from "../types.js";

export const RESEARCH_DISCLAIMER =
  "本結果は地方議会.comに収録された公開資料を対象としたAIによる調査支援です。検索結果がないことは、当該議会で議論がなかったことを意味しません。政策判断や正式な引用にあたっては、リンク先の自治体公式資料・議事録原文を確認してください。";

export const AI_FALLBACK_MESSAGE =
  "AI分析はできませんでしたが、関連する議事録検索結果はこちらです。";

export interface ResearchServiceOptions {
  analyzer?: ResearchAnalyzer;
  now?: () => number;
  createRequestId?: () => string;
  searchTermGenerator?: (question: string) => string[];
}

function fallbackSections(
  query: ResearchSearchQuery,
  evidences: readonly Evidence[],
  reason: "disabled" | "failed" | "no_evidence" | "invalid_citations",
): AnalysisSections {
  const municipalityGroups = new Map<
    string,
    { name: string; evidenceIds: string[] }
  >();
  for (const evidence of evidences) {
    const group = municipalityGroups.get(evidence.municipalityId) ?? {
      name: evidence.municipalityName,
      evidenceIds: [],
    };
    group.evidenceIds.push(evidence.id);
    municipalityGroups.set(evidence.municipalityId, group);
  }
  return {
    summary:
      reason === "no_evidence"
        ? "今回の検索条件では、AI分析の根拠にできる関連議事録を確認できませんでした。"
        : AI_FALLBACK_MESSAGE,
    keyIssues: [],
    municipalityComparisons:
      query.mode === "comparison"
        ? Array.from(municipalityGroups, ([municipalityId, group]) => ({
            municipalityId,
            municipalityName: group.name,
            summary: "関連する検索結果を確認してください。",
            points: [],
            evidenceIds: group.evidenceIds,
          }))
        : [],
    administrationResponsePatterns: [],
    policyOptions: [],
    nextResearchItems: ["リンク先の自治体公式議事録原文を確認してください。"],
    limitations: [
      reason === "disabled"
        ? "AI分析は設定により無効です。"
        : reason === "no_evidence"
          ? "AI分析に使える根拠が見つからなかったため、AIを呼び出していません。"
          : reason === "invalid_citations"
            ? "AI回答の引用検証に失敗したため、検索結果のみを返しています。"
          : "AI分析に失敗したため、検索結果のみを返しています。",
    ],
  };
}

function costEstimate(
  config: ResearchConfig,
  usage: TokenUsage,
): number | undefined {
  if (
    config.bedrockInputCostPerMillionTokens === undefined ||
    config.bedrockOutputCostPerMillionTokens === undefined
  ) {
    return undefined;
  }
  return (
    (usage.inputTokens * config.bedrockInputCostPerMillionTokens +
      usage.outputTokens * config.bedrockOutputCostPerMillionTokens) /
    1_000_000
  );
}

function analysisFailureCode(
  debugResearch: boolean,
  error: unknown,
): string {
  if (!(error instanceof Error)) return "analysis_failed";
  if (!debugResearch) return error.name;
  const message = error.message.replace(/[\r\n]+/g, " ").slice(0, 300);
  return message ? `${error.name}:${message}` : error.name;
}

function deduplicateDocuments(
  documents: readonly PolicySourceDocument[],
  limit: number,
): PolicySourceDocument[] {
  const seen = new Set<string>();
  const result: PolicySourceDocument[] = [];
  for (const document of documents) {
    if (seen.has(document.id)) continue;
    seen.add(document.id);
    result.push(document);
    if (result.length >= limit) break;
  }
  return result;
}

const EMPTY_VALIDATION: CitationValidationSummary = {
  valid: true,
  invalidEvidenceIds: [],
  removedReferenceCount: 0,
  removedSectionCount: 0,
};

export class ResearchService {
  private readonly analyzer: ResearchAnalyzer | undefined;
  private readonly now: () => number;
  private readonly createRequestId: () => string;
  private readonly searchTermGenerator: (question: string) => string[];

  constructor(
    private readonly config: ResearchConfig,
    private readonly router: QueryRouter,
    options: ResearchServiceOptions = {},
  ) {
    this.analyzer = options.analyzer;
    this.now = options.now ?? Date.now;
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.searchTermGenerator =
      options.searchTermGenerator ?? generateRuleBasedSearchTerms;
  }

  async research(query: ResearchSearchQuery): Promise<ResearchResponse> {
    const startedAt = this.now();
    const requestId = this.createRequestId();
    const searchQueries = this.searchTermGenerator(query.query);
    const effectiveQueries = searchQueries.length ? searchQueries : [query.query];
    const route = this.router.route(query);
    const [batches, municipalityNameMaps] = await Promise.all([
      Promise.all(route.adapters.map((adapter) => adapter.search(query))),
      Promise.all(
        route.adapters.map(async (adapter) => {
          if (!adapter.resolveMunicipalityNames || !query.municipalities?.length) {
            return new Map<string, string>();
          }
          try {
            return await adapter.resolveMunicipalityNames(query.municipalities);
          } catch {
            return new Map<string, string>();
          }
        }),
      ),
    ]);
    const documents = deduplicateDocuments(
      batches.flat(),
      this.config.maxResultsPerSearch,
    );
    const evidences = buildEvidenceSet(documents, {
      maxItems: this.config.maxEvidenceItems,
      maxChars: this.config.maxEvidenceChars,
    });
    const evidenceMunicipalities = new Set(
      evidences.map((evidence) => evidence.municipalityId),
    );
    const municipalitiesWithoutEvidence = (query.municipalities ?? []).filter(
      (municipalityId) => !evidenceMunicipalities.has(municipalityId),
    );
    const municipalityNames = new Map(
      municipalityNameMaps.flatMap((names) => Array.from(names.entries())),
    );
    const municipalitiesWithoutEvidenceLabels = municipalitiesWithoutEvidence.map(
      (municipalityId) => {
        const name = municipalityNames.get(municipalityId);
        return name ? `${name}（${municipalityId}）` : municipalityId;
      },
    );

    let sections: AnalysisSections;
    let aiStatus: "completed" | "fallback" | "disabled";
    let modelId: string | undefined;
    let usage: TokenUsage | undefined;
    let errorCode: string | undefined;
    let aiCallCount = 0;
    let citationValidation = EMPTY_VALIDATION;
    const aiEnabled =
      this.config.aiEnabled &&
      this.analyzer !== undefined &&
      this.config.bedrockModelId !== undefined &&
      this.config.maxLlmCallsPerRequest > 0;

    if (evidences.length === 0) {
      aiStatus = "fallback";
      sections = fallbackSections(query, evidences, "no_evidence");
      errorCode = "no_evidence";
    } else if (!aiEnabled) {
      aiStatus = "disabled";
      sections = fallbackSections(query, evidences, "disabled");
    } else {
      try {
        aiCallCount = 1;
        const outcome = await this.analyzer!.analyze({ query, evidences });
        const validated = validateCitations(outcome.sections, evidences);
        citationValidation = validated.summary;
        modelId = outcome.modelId;
        usage = outcome.usage;
        if (validated.summary.valid) {
          sections = validated.sections;
          aiStatus = "completed";
        } else {
          sections = fallbackSections(query, evidences, "invalid_citations");
          aiStatus = "fallback";
          errorCode = "citation_validation_failed";
        }
      } catch (error: unknown) {
        aiStatus = "fallback";
        sections = fallbackSections(query, evidences, "failed");
        errorCode = analysisFailureCode(this.config.debugResearch, error);
      }
    }

    const requiredLimitations = [
      "公開生成索引の議題抜粋のみを検索しており、議事録全文は追加取得していません。",
      "年度は会議日から日本の会計年度（4月〜翌3月）を算出し、日付のない一部資料のみ会議年を代替値にしています。",
      ...(route.unavailableSourceTypes.length
        ? [
            `未実装の資料種別は検索していません: ${route.unavailableSourceTypes.join(", ")}`,
          ]
        : []),
      ...(municipalitiesWithoutEvidence.length
        ? [
            `指定自治体のうち、今回の検索で比較根拠を取得できなかった自治体: ${municipalitiesWithoutEvidenceLabels.join(", ")}`,
          ]
        : []),
    ];
    const coverageFollowUp = municipalitiesWithoutEvidence.length
      ? `根拠を取得できなかった指定自治体（${municipalitiesWithoutEvidenceLabels.join(", ")}）について、自治体公式議事録を個別に確認してください。`
      : null;
    sections = {
      ...sections,
      nextResearchItems: Array.from(
        new Set([
          ...sections.nextResearchItems,
          ...(coverageFollowUp ? [coverageFollowUp] : []),
        ]),
      ),
      limitations: Array.from(
        new Set([...sections.limitations, ...requiredLimitations]),
      ),
    };

    const searchedSourceTypes = route.searchedSourceTypes as SourceType[];
    const estimatedCostUsd = usage ? costEstimate(this.config, usage) : undefined;
    return {
      requestId,
      result: {
        query: query.query,
        ...sections,
        evidences,
      },
      disclaimer: RESEARCH_DISCLAIMER,
      metadata: {
        mode: query.mode ?? "research",
        searchedSourceTypes,
        unavailableSourceTypes: route.unavailableSourceTypes,
        searchQueries: effectiveQueries,
        searchResultCount: documents.length,
        evidenceCount: evidences.length,
        ai: {
          status: aiStatus,
          callCount: aiCallCount,
          ...(modelId ? { modelId } : {}),
          ...(usage ? { usage } : {}),
          ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
          ...(errorCode ? { errorCode } : {}),
        },
        citationValidation,
        durationMs: Math.max(0, this.now() - startedAt),
        cacheHit: false,
      },
    };
  }
}
