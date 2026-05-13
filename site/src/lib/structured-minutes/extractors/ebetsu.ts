import type { StructuredMinutes } from "../types";

export type EbetsuExtractorInput = {
  html: string;
  officialUrl: string;
  meetingDate: string;
};

export function extractEbetsuStructuredMinutes(_input: EbetsuExtractorInput): StructuredMinutes {
  void _input;
  throw new Error(
    "extractEbetsuStructuredMinutes is a placeholder. MVP uses reviewed JSON fixtures first."
  );
}
