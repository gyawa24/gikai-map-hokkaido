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

export type SourceType = (typeof SOURCE_TYPES)[number];

export type EvidenceLevel =
  | "full_text_verified"
  | "excerpt_verified"
  | "metadata_only";

export interface PolicySourceDocument {
  id: string;
  municipalityId: string;
  municipalityName: string;
  sourceType: SourceType;
  documentType?: string;
  title: string;
  fiscalYear?: number;
  date?: string;
  meetingName?: string;
  committeeName?: string;
  speaker?: string;
  speakerRole?: string;
  department?: string;
  section?: string;
  page?: number;
  text: string;
  sourceUrl: string;
  topics?: string[];
  metadata?: Record<string, unknown>;
  evidenceLevel: EvidenceLevel;
}

export type ResearchMode = "research" | "comparison" | "question_prep";

export interface ResearchSearchQuery {
  query: string;
  municipalities?: string[];
  sourceTypes?: SourceType[];
  fiscalYears?: number[];
  mode?: ResearchMode;
}

export interface PolicySourceAdapter {
  readonly sourceTypes: SourceType[];
  search(query: ResearchSearchQuery): Promise<PolicySourceDocument[]>;
  getDocument?(id: string): Promise<PolicySourceDocument | null>;
  resolveMunicipalityNames?(
    municipalityIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export interface StructuredDataAdapter<TRecord> extends PolicySourceAdapter {
  searchRecords(query: ResearchSearchQuery): Promise<TRecord[]>;
  toPolicySourceDocument(record: TRecord): PolicySourceDocument;
}

export interface Evidence {
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
}

export interface ResearchResult {
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
}

export interface AnalysisSections
  extends Omit<ResearchResult, "query" | "evidences"> {}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AnalysisOutcome {
  sections: AnalysisSections;
  modelId: string;
  usage: TokenUsage;
  latencyMs: number;
}

export interface ResearchAnalyzer {
  analyze(input: {
    query: ResearchSearchQuery;
    evidences: Evidence[];
  }): Promise<AnalysisOutcome>;
}

export interface CitationValidationSummary {
  valid: boolean;
  invalidEvidenceIds: string[];
  removedReferenceCount: number;
  removedSectionCount: number;
}

export interface ResearchResponseMetadata {
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
    usage?: TokenUsage;
    estimatedCostUsd?: number;
    errorCode?: string;
  };
  citationValidation: CitationValidationSummary;
  durationMs: number;
  cacheHit: boolean;
}

export interface ResearchResponse {
  requestId: string;
  result: ResearchResult;
  disclaimer: string;
  metadata: ResearchResponseMetadata;
}

export interface BudgetRecord {
  municipalityId: string;
  fiscalYear: number;
  department?: string;
  division?: string;
  projectName: string;
  budgetType: "initial" | "supplementary";
  amount?: number;
  description?: string;
  sourceUrl: string;
}

export interface PolicyRelation {
  fromId: string;
  toId: string;
  relationType:
    | "based_on"
    | "implements"
    | "funded_by"
    | "managed_by"
    | "measured_by"
    | "discussed_in"
    | "evaluated_by"
    | "related_to";
}
