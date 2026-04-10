export type Member = {
  seat_number: number;
  name: string;
  furigana: string;
  party?: string;
  faction: string;
  committees: string[];
  votes?: number;
};

export type MemberActivitySession = {
  session: string;
  year: string;
  topics: string[];
};

export type MemberActivity = {
  name: string;
  session_count: number;
  top_topics: string[];
  all_topics: string[];
  sessions: MemberActivitySession[];
};
