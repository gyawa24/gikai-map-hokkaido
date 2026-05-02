export type SessionSourceType = "youtube" | "web";
export type SessionSourceSegment = {
  title: string;
  view_url: string;
  media_url?: string;
  player_url?: string;
  thumbnail_url?: string;
};

export type SegmentDetailQA = { q: string; a: string };
export type SegmentDetailTopic = {
  theme: string;
  icon: string;
  color: string;
  summary: string;
  qa: SegmentDetailQA[];
};
export type SegmentDetail = {
  speaker: string;
  overview: string;
  topics: SegmentDetailTopic[];
};

export type SessionSegment = {
  index: number;
  label: string;
  start_time?: string;
  end_time?: string;
  summary?: string;
  topics?: string[];
  transcript?: string;
  detail?: SegmentDetail;
};

export type Session = {
  id: string;
  youtube_id?: string;
  source_type?: SessionSourceType;
  source_url?: string;
  source_label?: string;
  source_thumbnail_url?: string;
  source_segments?: SessionSourceSegment[];
  full_transcript?: string;
  title: string;
  date: string;
  city: string;
  committee?: string;
  generated_at?: string;
  segments: SessionSegment[];
};

export type SessionSummary = {
  id: string;
  youtube_id?: string;
  source_type?: SessionSourceType;
  source_url?: string;
  source_label?: string;
  source_thumbnail_url?: string;
  title: string;
  date: string;
  committee?: string;
  segment_count: number;
  has_transcript: boolean;
  has_summary: boolean;
  speakers?: string[];
};
