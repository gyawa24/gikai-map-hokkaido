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

export type MemberActivitySession = {
  session: string;
  year: string;
  council_id: number;
  topics: string[];
  summary_topics?: string[];
};

export type MemberActivity = {
  name: string;
  session_count: number;
  themes: string[];
  summary_topics?: string[];
  top_topics: string[];
  all_topics: string[];
  sessions: MemberActivitySession[];
};
