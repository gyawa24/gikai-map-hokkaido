export type CouncilPublicationFeatureType =
  | "general_questions"
  | "meeting_summaries"
  | "votes"
  | "council_reports"
  | "legacy_minutes";

export type CouncilPublicationSourceType =
  | "html"
  | "pdf"
  | "video"
  | "newsletter"
  | "external";

export type CouncilPublicationOfficialStatus =
  | "official"
  | "summary"
  | "newsletter"
  | "video"
  | "legacy";

export type CouncilPublicationCoverage = {
  has_full_minutes: boolean;
  includes_questions?: boolean;
  includes_answers?: boolean;
  includes_votes?: boolean;
  includes_agenda?: boolean;
};

export type CouncilPublicationPerson = {
  name: string;
  role?: string;
};

export type CouncilPublicationItem = {
  id: string;
  feature_type: CouncilPublicationFeatureType;
  title: string;
  source_url: string;
  source_type: CouncilPublicationSourceType;
  official_status: CouncilPublicationOfficialStatus;
  coverage: CouncilPublicationCoverage;
  source_label?: string;
  published_date?: string;
  fiscal_year?: string;
  meeting_name?: string;
  document_url?: string;
  media_url?: string;
  people?: CouncilPublicationPerson[];
  tags?: string[];
  notes?: string;
};

export type CouncilPublicationIndex = {
  schema: "council_publication.v1";
  municipality_slug: string;
  generated_at: string;
  source_checked_at?: string;
  items: CouncilPublicationItem[];
};
