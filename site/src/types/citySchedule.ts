export type CitySchedule = {
  source_url: string;
  note: string;
  pdf_schedules: Array<{
    label: string;
    url: string;
  }>;
};
