export type SearchExcerptSegment = {
  text: string;
  /** UTF-16 offsets within the supplied search evidence, never citation offsets. */
  start: number;
  end: number;
};

export type SearchExcerpts = {
  snippet: string;
  snippetSegments: SearchExcerptSegment[];
  separated: boolean;
  /** Coverage of literal terms present in the body, not all search token groups. */
  snippetCoverageComplete: boolean;
};

export type MultiTermSearchExcerpt = Omit<SearchExcerpts, "snippet"> & {
  context: string;
  snippetSourceLength: number;
};

export function buildSearchExcerpts(text: string, terms?: string[]): SearchExcerpts;
export function buildMultiTermSearchExcerpt(text: string, terms?: string[]): MultiTermSearchExcerpt | null;
