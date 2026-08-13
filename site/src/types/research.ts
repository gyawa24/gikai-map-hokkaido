export const SOURCE_TYPES = [
  "plenary_minutes",
  "committee_minutes",
  "administrative_plan",
  "budget",
  "settlement",
  "project_evaluation",
  "ordinance",
  "organization",
  "statistics",
  "open_data",
  "other",
] as const;

export const RESEARCH_MODES = ["research", "comparison", "question_prep"] as const;

export const RESEARCH_QUERY_MAX_LENGTH = 2_000;

export const RESEARCH_DISCLAIMER =
  "本結果は地方議会.comに収録された公開資料を対象としたAIによる調査支援です。検索結果がないことは、当該議会で議論がなかったことを意味しません。政策判断や正式な引用にあたっては、リンク先の自治体公式資料・議事録原文を確認してください。";

export type SourceType = (typeof SOURCE_TYPES)[number];
export type ResearchMode = (typeof RESEARCH_MODES)[number];
export type EvidenceLevel =
  | "full_text_verified"
  | "excerpt_verified"
  | "metadata_only";

export type ResearchRequest = {
  query: string;
  municipalities?: string[];
  sourceTypes?: SourceType[];
  fiscalYears?: number[];
  mode?: ResearchMode;
};

export type Evidence = {
  id: string;
  municipalityId: string;
  municipalityName: string;
  sourceType: SourceType;
  title: string;
  date?: string;
  meetingName?: string;
  committeeName?: string;
  speaker?: string;
  speakerRole?: string;
  excerpt: string;
  sourceUrl: string;
  evidenceLevel: EvidenceLevel;
};

export type ResearchResult = {
  query: string;
  summary: string;
  keyIssues: Array<{
    title: string;
    description: string;
    evidenceIds: string[];
  }>;
  municipalityComparisons: Array<{
    municipalityId: string;
    municipalityName: string;
    summary: string;
    points: string[];
    evidenceIds: string[];
  }>;
  administrationResponsePatterns: Array<{
    pattern: string;
    description: string;
    evidenceIds: string[];
  }>;
  policyOptions: Array<{
    title: string;
    description: string;
    evidenceIds: string[];
  }>;
  nextResearchItems: string[];
  evidences: Evidence[];
  limitations: string[];
};

export type ResearchResponseMetadata = {
  mode: ResearchMode;
  searchedSourceTypes: SourceType[];
  unavailableSourceTypes: SourceType[];
  searchQueries: string[];
  searchResultCount: number;
  evidenceCount: number;
  ai: {
    status: "completed" | "fallback" | "disabled";
    modelId?: string;
    callCount: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    estimatedCostUsd?: number;
    errorCode?: string;
  };
  citationValidation: {
    valid: boolean;
    invalidEvidenceIds: string[];
    removedReferenceCount: number;
    removedSectionCount: number;
  };
  durationMs: number;
  cacheHit: boolean;
};

export type ResearchResponse = {
  requestId: string;
  result: ResearchResult;
  disclaimer: string;
  metadata: ResearchResponseMetadata;
};

export type ResearchMunicipalityOption = {
  slug: string;
  name: string;
  region: string;
};
