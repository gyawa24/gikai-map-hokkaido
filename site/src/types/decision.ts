export type PdfLink = {
  title: string;
  url: string;
};

export type Decision = {
  session: string;
  source_url: string;
  pdf_links: PdfLink[];
  description: string;
};
