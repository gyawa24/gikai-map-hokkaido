export type MinuteItem = {
  minute_id: number;
  title: string;
  minute_type: string;
  text: string;
};

export type MinuteSchedule = {
  schedule_id: number;
  name: string;
  page_no: number;
  minutes: MinuteItem[];
};

export type MinutesSession = {
  council_id: number;
  name: string;
  year: string;
  japanese_year: string;
  type_label: string;
  schedules: MinuteSchedule[];
};

export type MinutesIndexItem = {
  council_id: number;
  name: string;
  year: string;
  japanese_year: string;
  type_label: string;
  file: string;
  schedule_count?: number;
};
