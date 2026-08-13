const MAX_DEFAULT_TERMS = 4;
const GENERIC_STOP_WORDS = new Set([
  "これまで",
  "現在",
  "過去",
  "主に",
  "論点",
  "議論",
  "政策",
  "施策",
  "議会",
  "自治体",
  "対応",
  "方法",
  "中心",
]);
const POLICY_SUFFIXES = [
  "無償化",
  "値上げ",
  "値下げ",
  "支援",
  "対策",
  "整備",
  "導入",
  "活用",
  "利用",
  "推進",
  "助成",
  "補助",
  "削減",
  "拡充",
  "充実",
  "確保",
  "改善",
  "更新",
] as const;

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function unique(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function splitPolicySuffix(value: string): string[] {
  if (value.endsWith("政策") && value.length > 2) {
    return [value.slice(0, -2)];
  }
  const suffix = POLICY_SUFFIXES.find(
    (candidate) => value.endsWith(candidate) && value.length > candidate.length + 1,
  );
  return suffix ? [value.slice(0, -suffix.length), suffix] : [value];
}

function hasMunicipalityBoundary(value: string, endIndex: number): boolean {
  if (endIndex >= value.length) return true;
  const remainder = value.slice(endIndex);
  return (
    /^[\s、。,.?？!！「」『』"()（）・]/.test(remainder) ||
    /^(?:の|では|で|は|が|を|に|へ|と|や|も|から|まで|について|における)/.test(
      remainder,
    )
  );
}

function removeMunicipalityMentions(
  question: string,
  municipalityNames: readonly string[],
): string {
  const names = Array.from(
    new Set(municipalityNames.map(normalize).filter(Boolean)),
  ).sort((left, right) => right.length - left.length);
  let result = question;
  for (const name of names) {
    let searchFrom = 0;
    while (searchFrom < result.length) {
      const index = result.indexOf(name, searchFrom);
      if (index < 0) break;
      const endIndex = index + name.length;
      if (hasMunicipalityBoundary(result, endIndex)) {
        result = `${result.slice(0, index)} ${result.slice(endIndex)}`;
        searchFrom = index + 1;
      } else {
        searchFrom = endIndex;
      }
    }
  }
  return result;
}

function genericSearchCandidates(
  question: string,
  municipalityNames: readonly string[],
): string[] {
  const withoutMunicipalities = removeMunicipalityMentions(
    question,
    municipalityNames,
  );
  const stripped = withoutMunicipalities
    .replace(/北海道内?/g, " ")
    .replace(/(?:地方議会|自治体議会|市町村議会|議会)/g, " ")
    .replace(/(?:これまで|現在|過去|主に)/g, " ")
    .replace(/(?:どのような|どんな|どのように|何が|何を)/g, " ")
    .replace(/(?:について|に関する|に関して|をめぐる|における)/g, " ")
    .replace(/(?:主な)?論点(?:が|を)?/g, " ")
    .replace(/(?:議論|審議)(?:されてきた|されています|されている|された|している|して)?(?:か)?/g, " ")
    .replace(/(?:整理|比較|調査)(?:して)?(?:ください|ほしい)?/g, " ")
    .replace(/教えて(?:ください)?/g, " ")
    .replace(/(?:ありますか|ですか|ますか|してください|ください)/g, " ")
    .replace(/[、。,.?？!！「」『』"()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return [];

  const tokens = stripped
    .replace(/の/g, " ")
    .split(/\s+/)
    .flatMap(splitPolicySuffix)
    .map((value) => value.trim())
    .filter(
      (value) => value.length >= 2 && !GENERIC_STOP_WORDS.has(value),
    )
    .slice(0, 6);
  const tokenQuery = tokens.join(" ");
  return [tokenQuery, stripped].filter(
    (value, index, values) =>
      value.length >= 2 && value.length <= 80 && values.indexOf(value) === index,
  );
}

/** AIを呼ばず、頻出政策テーマを既存議事録検索向けの短い語へ展開する。 */
export function generateRuleBasedSearchTerms(
  question: string,
  maxTerms = MAX_DEFAULT_TERMS,
  municipalityNames: readonly string[] = [],
): string[] {
  const normalized = normalize(question);
  if (!normalized || maxTerms <= 0) return [];

  const candidates: string[] = [];
  if (/学校給食|給食費/.test(normalized) && /無償|無料/.test(normalized)) {
    candidates.push("学校給食費 無償化", "給食費 無償化", "学校給食 無償化");
  }
  if (/不登校/.test(normalized)) {
    candidates.push("不登校 支援", "不登校");
  }
  if (/生成\s*(?:AI|ＡＩ)|生成人工知能/i.test(normalized)) {
    candidates.push("生成AI", "DX", "AI 行政", "ChatGPT");
  }
  if (/医療費/.test(normalized) && /無償|無料|助成/.test(normalized)) {
    candidates.push("医療費 無償化", "子ども 医療費", "医療費 助成");
  }

  for (const match of normalized.matchAll(/[「『\"]([^」』\"]{2,40})[」』\"]/g)) {
    if (match[1]) candidates.push(match[1]);
  }

  if (candidates.length === 0) {
    candidates.push(...genericSearchCandidates(normalized, municipalityNames));
  }

  return unique(candidates, Math.max(1, Math.floor(maxTerms)));
}
