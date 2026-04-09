export type SessionSegment = {
  index: number;
  label: string;
  start_time?: string;
  end_time?: string;
  summary?: string;
  topics?: string[];
  transcript?: string;
};

export type Session = {
  id: string;
  youtube_id: string;
  title: string;
  date: string;
  city: string;
  committee?: string;
  generated_at?: string;
  segments: SessionSegment[];
};

export type SessionSummary = {
  id: string;
  youtube_id: string;
  title: string;
  date: string;
  committee?: string;
  segment_count: number;
  has_transcript: boolean;
  has_summary: boolean;
};
