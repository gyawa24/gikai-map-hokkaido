export type SpeakerType =
  | "council_member"
  | "chair"
  | "mayor"
  | "vice_mayor"
  | "executive"
  | "education_board"
  | "office_staff"
  | "committee_chair"
  | "interjection"
  | "unknown";

export type TurnType =
  | "question"
  | "answer"
  | "re_question"
  | "re_answer"
  | "request"
  | "procedure"
  | "report"
  | "debate"
  | "vote"
  | "other"
  | "unknown";

export type ExtractionMethod =
  | "rule_based"
  | "manual"
  | "ai_assisted"
  | "rule_based_with_manual_review";

export type ReviewStatus = "auto" | "needs_review" | "reviewed" | "rejected";

export type SourcePosition = {
  official_url: string;
  document_char_start?: number;
  document_char_end?: number;
  turn_char_start?: number;
  turn_char_end?: number;
  dom_path?: string;
  heading_path?: string[];
  local_anchor?: string;
  search_hint?: string;
};

export type ExtractionMeta = {
  method: ExtractionMethod;
  confidence: number;
  extractor_version: string;
  warnings: string[];
  reviewed_by?: string;
  reviewed_at?: string;
};

export type SourceDocument = {
  id: string;
  municipality_id: string;
  municipality_name: string;
  official_url: string;
  title: string;
  meeting_date: string;
  fetched_at: string;
  published_at?: string;
  source_type: "official_html" | "official_pdf" | "other";
  raw_html_hash?: string;
  main_text_hash?: string;
  extractor_version: string;
};

export type Speaker = {
  id: string;
  municipality_id: string;
  name_original: string;
  name_normalized: string;
  role_original?: string;
  speaker_type: SpeakerType;
  term_start?: string;
  term_end?: string;
  faction?: string;
  party?: string;
  official_profile_url?: string;
  aliases: string[];
};

export type Turn = {
  id: string;
  source_document_id: string;
  municipality_id: string;
  meeting_date: string;
  order_index: number;
  speaker_id?: string;
  speaker_name_original: string;
  speaker_name_normalized?: string;
  speaker_role_original?: string;
  speaker_type: SpeakerType;
  turn_type: TurnType;
  question_round?: number;
  agenda_title?: string;
  text_original: string;
  text_normalized?: string;
  source_position: SourcePosition;
  extraction: ExtractionMeta;
};

export type TopicFlowItem = {
  role: "question" | "answer" | "re_question" | "re_answer" | "request" | "other";
  turn_id: string;
  snippet_id?: string;
  speaker_id?: string;
  speaker_name_original: string;
  label: string;
  round_index?: number;
};

export type QuestionBlock = {
  id: string;
  source_document_id: string;
  municipality_id: string;
  meeting_date: string;
  order_index: number;
  questioner_speaker_id?: string;
  questioner_name_original: string;
  questioner_name_normalized?: string;
  question_method?: "one_by_one" | "comprehensive" | "mixed" | "unknown";
  title_original?: string;
  agenda_titles: string[];
  turn_ids: string[];
  topic_block_ids: string[];
  start_turn_id: string;
  end_turn_id: string;
  source_position: SourcePosition;
  extraction: ExtractionMeta;
};

export type TopicSnippet = {
  id: string;
  topic_block_id: string;
  turn_id: string;
  order_index: number;
  snippet_role: "question" | "answer" | "re_question" | "re_answer" | "request" | "context";
  text_original: string;
  turn_char_start: number;
  turn_char_end: number;
  document_char_start?: number;
  document_char_end?: number;
  source_position: SourcePosition;
  extraction: ExtractionMeta;
};

export type TopicBlock = {
  id: string;
  question_block_id: string;
  source_document_id: string;
  order_index: number;
  title_original: string;
  title_normalized?: string;
  parent_topic_title?: string;
  policy_area_tags: string[];
  topic_tags: string[];
  questioner_speaker_id?: string;
  respondent_speaker_ids: string[];
  related_turn_ids: string[];
  topic_snippet_ids: string[];
  flow: TopicFlowItem[];
  source_position: SourcePosition;
  review_status: ReviewStatus;
  public_visible: boolean;
  extraction: ExtractionMeta;
};

export type StructuredMinutes = {
  read_quality?: {
    contract: "legacy-v1-safe-read";
    unknown_date_count: number;
    withheld_topic_count: number;
    missing_source_position_count: number;
    provenance_status: "unverified";
    freshness_status: "unverified";
  };
  source_document: SourceDocument;
  speakers: Speaker[];
  turns: Turn[];
  question_blocks: QuestionBlock[];
  topic_blocks: TopicBlock[];
  topic_snippets: TopicSnippet[];
};
