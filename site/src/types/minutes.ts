export type MinuteItem = {
  minute_id: number;
  title: string;
  minute_type: string;
  text: string;
  source_url?: string;
};

export type MinuteSchedule = {
  schedule_id: number;
  name: string;
  page_no: number;
  date?: string;
  source_url?: string;
  minutes: MinuteItem[];
};

export type MinutesSession = {
  council_id: number;
  name: string;
  year: string;
  japanese_year: string;
  type_label: string;
  schedules: MinuteSchedule[];
  source_url?: string;
};

export type MinutesIndexItem = {
  council_id: number;
  name: string;
  year: string;
  japanese_year: string;
  type_label: string;
  file: string;
  schedule_count?: number;
  start_date?: string;
  end_date?: string;
  sort_date?: string;
  date_precision?: "day" | "month";
  source_url?: string;
};

export type MinutesSpeaker = {
  name: string;
  role: string;
  speech_count: number;
};

export type MinutesQuestioner = {
  name: string;
  topics: string[];
  ai_topics?: string[];
  topics_source?: "minutes_structure" | "ai_generated";
};

export type MinutesEnriched = {
  council_id: number;
  name: string;
  generated_at: string;
  summary: string;
  highlights: string[];
  tags: string[];
  speakers: MinutesSpeaker[];
  questioners: MinutesQuestioner[];
};
