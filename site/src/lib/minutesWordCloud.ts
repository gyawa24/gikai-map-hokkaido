import { cache } from "react";
import { getMinutesEnrichedDocs, getMinutesIndex, readCityJson } from "@/lib/cityData";
import type { MinutesSession } from "@/types/minutes";

type VocabularyFile = {
  key_terms?: string[];
};

type WordCloudScope = "all" | "plenary" | "representative" | "general";
type CorpusBucket = Record<WordCloudScope, string[]>;
type PeriodMode = "all" | "year" | "meeting";

type MinuteDocSummary = {
  year: string;
  id: string;
  label: string;
  isRegularPlenary: boolean;
  buckets: CorpusBucket;
  chars: Record<WordCloudScope, number>;
};

export type MinutesWordCloudEntry = {
  term: string;
  count: number;
};

export type MinutesWordCloudData = {
  entries: MinutesWordCloudEntry[];
  minutesCount: number;
  analyzedChars: number;
  latestYear: string | null;
};

export type MinutesWordCloudOption = {
  value: string;
  label: string;
};

export type MinutesWordCloudView = {
  modes: Array<MinutesWordCloudOption & { value: PeriodMode }>;
  years: MinutesWordCloudOption[];
  meetings: MinutesWordCloudOption[];
  scopes: Array<MinutesWordCloudOption & { value: WordCloudScope }>;
  datasets: Record<string, MinutesWordCloudData>;
};

const SKIP_MINUTE_TYPES = new Set(["名簿", "△議題", "○議長"]);
const QUESTION_SCOPE_LABELS: Array<MinutesWordCloudOption & { value: WordCloudScope }> = [
  { value: "all", label: "全体" },
  { value: "plenary", label: "本会議" },
  { value: "representative", label: "代表質問" },
  { value: "general", label: "一般質問" },
];
const PERIOD_MODE_LABELS: Array<MinutesWordCloudOption & { value: PeriodMode }> = [
  { value: "all", label: "全年度" },
  { value: "year", label: "年度ごと" },
  { value: "meeting", label: "定例会ごと" },
];

function datasetKey(mode: PeriodMode, value: string, scope: WordCloudScope): string {
  return `${mode}:${value}:${scope}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTerm(term: string): string {
  return term
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/^Rapidus$/i, "ラピダス")
    .replace(/ラピダス社/g, "ラピダス")
    .trim();
}

function collectCandidateTerms(city: string): string[] {
  const vocabulary = readCityJson<VocabularyFile>(city, "vocabulary.json");
  const enrichedDocs = getMinutesEnrichedDocs(city);
  const candidates = new Set<string>();

  for (const term of vocabulary?.key_terms ?? []) {
    const normalized = normalizeTerm(term);
    if (normalized.length >= 2) candidates.add(normalized);
  }

  for (const doc of enrichedDocs) {
    for (const tag of doc.tags ?? []) {
      const normalized = normalizeTerm(tag);
      if (normalized.length >= 2) candidates.add(normalized);
    }
  }

  return Array.from(candidates);
}

function buildEmptyBucket(): CorpusBucket {
  return {
    all: [],
    plenary: [],
    representative: [],
    general: [],
  };
}

function currentQuestionScope(text: string): WordCloudScope | null {
  if (text.includes("代表質問")) return "representative";
  if (text.includes("一般質問")) return "general";
  return null;
}

function buildDocSummary(
  city: string,
  file: string,
  id: string,
  label: string,
  year: string,
  isPlenary: boolean,
  isRegularPlenary: boolean
): MinuteDocSummary | null {
  const doc = readCityJson<MinutesSession>(city, `minutes/${file}`);
  if (!doc) return null;

  const buckets = buildEmptyBucket();
  const chars: Record<WordCloudScope, number> = {
    all: 0,
    plenary: 0,
    representative: 0,
    general: 0,
  };

  for (const schedule of doc.schedules ?? []) {
    let activeQuestionScope: WordCloudScope | null = null;

    for (const minute of schedule.minutes ?? []) {
      const headingText = `${minute.title ?? ""}\n${minute.text ?? ""}`;
      if (minute.minute_type === "△議題") {
        activeQuestionScope = currentQuestionScope(headingText);
        continue;
      }
      if (SKIP_MINUTE_TYPES.has(minute.minute_type)) continue;

      const text = minute.text?.trim();
      if (!text) continue;

      buckets.all.push(text);
      chars.all += text.length;

      if (isPlenary) {
        buckets.plenary.push(text);
        chars.plenary += text.length;
      }

      if (activeQuestionScope === "representative") {
        buckets.representative.push(text);
        chars.representative += text.length;
      }

      if (activeQuestionScope === "general") {
        buckets.general.push(text);
        chars.general += text.length;
      }
    }
  }

  return { year, id, label, isRegularPlenary, buckets, chars };
}

function countTerms(corpus: string, terms: string[]): MinutesWordCloudEntry[] {
  const counts = new Map<string, number>();
  for (const term of terms) {
    const matches = corpus.match(new RegExp(escapeRegExp(term), "g"));
    const count = matches?.length ?? 0;
    if (count > 0) counts.set(term, count);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 18)
    .map(([term, count]) => ({ term, count }));
}

export const getMinutesWordCloud = cache((city: string): MinutesWordCloudView => {
  const minutesIndex = getMinutesIndex(city);
  const terms = collectCandidateTerms(city);
  const docSummaries: MinuteDocSummary[] = [];
  const yearMap = new Map<string, string>();
  const meetingOptions: MinutesWordCloudOption[] = [];

  for (const item of minutesIndex) {
    if (!item.year) continue;
    const isRegularPlenary =
      item.type_label.includes("本会議") &&
      item.type_label.includes("定例会") &&
      !item.type_label.includes("委員会") &&
      !item.type_label.includes("補正");
    const summary = buildDocSummary(
      city,
      item.file,
      String(item.council_id),
      item.name,
      item.year,
      item.type_label.includes("本会議"),
      isRegularPlenary
    );
    if (!summary) continue;
    docSummaries.push(summary);
    yearMap.set(item.year, item.japanese_year);
    if (isRegularPlenary) {
      meetingOptions.push({ value: String(item.council_id), label: item.name });
    }
  }

  const years = Array.from(yearMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0], "ja"))
    .map(([value, label]) => ({ value, label }));

  const datasets: Record<string, MinutesWordCloudData> = {};

  const buildDatasets = (mode: PeriodMode, value: string, label: string | null, docs: MinuteDocSummary[]) => {
    for (const scope of QUESTION_SCOPE_LABELS.map((option) => option.value)) {
      const parts = docs.flatMap((doc) => doc.buckets[scope]);
      const analyzedChars = docs.reduce((sum, doc) => sum + doc.chars[scope], 0);
      const minutesCount = docs.filter((doc) => doc.chars[scope] > 0).length;
      const entries = parts.length > 0 && terms.length > 0 ? countTerms(parts.join("\n"), terms) : [];

      datasets[datasetKey(mode, value, scope)] = {
        entries,
        minutesCount,
        analyzedChars,
        latestYear: label,
      };
    }
  };

  buildDatasets("all", "all", years[0]?.label ?? null, docSummaries);

  for (const year of years) {
    buildDatasets(
      "year",
      year.value,
      year.label,
      docSummaries.filter((doc) => doc.year === year.value)
    );
  }

  for (const meeting of meetingOptions) {
    buildDatasets(
      "meeting",
      meeting.value,
      meeting.label,
      docSummaries.filter((doc) => doc.id === meeting.value && doc.isRegularPlenary)
    );
  }

  return {
    modes: PERIOD_MODE_LABELS,
    years,
    meetings: meetingOptions,
    scopes: QUESTION_SCOPE_LABELS,
    datasets,
  };
});
