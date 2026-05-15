export type ScheduleEvent = {
  date: string;
  content: string;
  period_label: string;
};

export type ScheduleLink = {
  label: string;
  url: string;
};

export type ScheduleLinkIndex = {
  source_url: string;
  note: string;
  pdf_schedules: ScheduleLink[];
};
