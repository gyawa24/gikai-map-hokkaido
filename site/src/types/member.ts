export type Member = {
  seat_number: number;
  name: string;
  furigana: string;
  party?: string;
  faction: string;
  committees: string[];
  votes?: number;
  photo_url?: string;
};

export type MemberActivitySourceType = "official_minutes" | "video_transcript";

export type MemberActivitySourceStatus = "official" | "preliminary";

export type MemberActivityQuestionKind =
  | "general_question"
  | "representative_question"
  | "committee_question"
  | "plenary_question"
  | "other_question";

export type MemberActivityQa = {
  question: string;
  answer: string;
};

export type MemberActivityTopicDetail = {
  title: string;
  summary?: string;
  qa?: MemberActivityQa[];
};

export type MemberActivitySession = {
  record_id?: string;
  session: string;
  year: string;
  council_id: number;
  date?: string;
  dates?: string[];
  question_kind?: MemberActivityQuestionKind;
  block_id?: string;
  schedule_id?: number | null;
  schedule_name?: string;
  agenda_title?: string;
  marker_minute_id?: number | null;
  end_minute_id?: number | null;
  closure_method?: string;
  source_type?: MemberActivitySourceType;
  source_status?: MemberActivitySourceStatus;
  source_label?: string;
  source_url?: string;
  source_note?: string;
  href?: string;
  start_time?: string;
  end_time?: string;
  overview?: string;
  topics: string[];
  summary_topics?: string[];
  topic_details?: MemberActivityTopicDetail[];
  evidence_minute_ids?: number[];
  evidence_segment_ids?: string[];
};

export type MemberActivity = {
  name: string;
  session_count: number;
  official_session_count?: number;
  preliminary_session_count?: number;
  general_question_count?: number;
  representative_question_count?: number;
  committee_question_count?: number;
  plenary_question_count?: number;
  themes: string[];
  summary_topics?: string[];
  top_topics: string[];
  all_topics: string[];
  sessions: MemberActivitySession[];
};
