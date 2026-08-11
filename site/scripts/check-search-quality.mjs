import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const CASES_FILE = path.join(DATA_DIR, "search_quality_cases.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function normalizeForSearch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase()
    .trim();
}

function compactForSearch(text) {
  return normalizeForSearch(text).replace(/\s+/g, "");
}

function tokenize(query) {
  return String(query ?? "").trim().split(/\s+/).filter(Boolean);
}

function textMatches(text, tokens, operator) {
  if (tokens.length === 0) return false;
  const normalizedText = normalizeForSearch(text);
  const compactText = compactForSearch(text);
  const matches = tokens.map((token) => {
    const normalizedToken = normalizeForSearch(token);
    const compactToken = compactForSearch(token);
    return (
      normalizedText.includes(normalizedToken) ||
      (compactToken.length >= 2 && compactText.includes(compactToken))
    );
  });
  return operator === "or" ? matches.some(Boolean) : matches.every(Boolean);
}

function matchScore(text, tokens) {
  const normalizedText = normalizeForSearch(text);
  const compactText = compactForSearch(text);
  return tokens.reduce((score, token) => {
    const normalizedToken = normalizeForSearch(token);
    const compactToken = compactForSearch(token);
    if (normalizedText.includes(normalizedToken)) return score + 2;
    if (compactToken.length >= 2 && compactText.includes(compactToken)) return score + 1;
    return score;
  }, 0);
}

function uniqueTexts(values) {
  const seen = new Set();
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function loadIndexForCase(testCase) {
  const city = testCase.city;
  const cityIndexPath = city
    ? path.join(PUBLIC_GENERATED_DIR, "search-indexes", `${city}.json`)
    : "";
  const indexPath = city && fs.existsSync(cityIndexPath)
    ? cityIndexPath
    : path.join(PUBLIC_GENERATED_DIR, "search-index.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`検索索引が見つかりません: ${indexPath}\n先に npm run build-search-index を実行してください。`);
  }
  return { indexPath, index: readJson(indexPath) };
}

function buildCandidates(index) {
  const candidates = [];

  for (const activity of index.memberActivities ?? []) {
    const topics = uniqueTexts([
      ...(activity.summary_topics ?? []),
      ...(activity.topics ?? []),
    ]);
    candidates.push({
      source: "member_activity",
      city: activity.city,
      cityName: activity.cityName,
      council_id: activity.council_id,
      member_name: activity.member_name,
      title: activity.council_name,
      text: [
        activity.cityName,
        activity.member_name,
        activity.council_name,
        ...topics,
      ].join(" "),
    });
  }

  for (const agenda of index.agendas ?? []) {
    candidates.push({
      source: "agenda",
      city: agenda.city,
      cityName: agenda.cityName,
      council_id: agenda.council_id,
      title: agenda.council_name,
      text: [
        agenda.cityName,
        agenda.council_name,
        agenda.schedule_name,
        agenda.agenda_title,
        agenda.text,
      ].join(" "),
    });
  }

  for (const member of index.members ?? []) {
    candidates.push({
      source: "member",
      city: member.city,
      cityName: member.cityName,
      member_name: member.name,
      title: member.name,
      text: [
        member.cityName,
        member.name,
        member.furigana,
        member.party,
        member.faction,
        ...(member.committees ?? []),
      ].join(" "),
    });
  }

  for (const session of index.sessions ?? []) {
    const segmentText = (session.segments ?? [])
      .flatMap((segment) => [
        segment.label,
        segment.summary,
        ...(segment.topics ?? []),
        segment.transcript,
      ])
      .join(" ");
    candidates.push({
      source: "session",
      city: session.city,
      cityName: session.cityName,
      session_id: session.id,
      title: session.title,
      text: [session.cityName, session.title, session.committee, segmentText].join(" "),
    });
  }

  for (const doc of index.enriched ?? []) {
    candidates.push({
      source: "enriched",
      city: doc.city,
      cityName: doc.cityName,
      council_id: doc.council_id,
      title: doc.name,
      text: [
        doc.cityName,
        doc.name,
        doc.summary,
        ...(doc.highlights ?? []),
        ...(doc.tags ?? []),
      ].join(" "),
    });
  }

  for (const decision of index.decisions ?? []) {
    candidates.push({
      source: "decision",
      city: decision.city,
      cityName: decision.cityName,
      title: decision.session,
      text: [decision.cityName, decision.session, decision.description].join(" "),
    });
  }

  return candidates;
}

function candidateMatchesExpected(candidate, expected) {
  if (expected.source && candidate.source !== expected.source) return false;
  if (expected.council_id && Number(candidate.council_id) !== Number(expected.council_id)) return false;
  if (expected.session_id && candidate.session_id !== expected.session_id) return false;
  if (expected.member_name && candidate.member_name !== expected.member_name) return false;
  for (const text of expected.textIncludes ?? []) {
    if (!String(candidate.text ?? "").includes(text)) return false;
  }
  return true;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { ids: new Set(), city: "", json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      options.ids.add(args[i + 1]);
      i += 1;
    } else if (arg === "--city") {
      options.city = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/check-search-quality.mjs [--id CASE_ID] [--city SLUG] [--json]`);
      process.exit(0);
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs();
  const cases = readJson(CASES_FILE);
  const targetCases = cases.filter((testCase) => {
    if (testCase.bigramOnly) return false;
    if (options.ids.size > 0 && !options.ids.has(testCase.id)) return false;
    if (options.city && testCase.city !== options.city) return false;
    return true;
  });
  if (targetCases.length === 0) {
    throw new Error("対象の検索品質ケースがありません。");
  }

  const results = [];
  for (const testCase of targetCases) {
    const { indexPath, index } = loadIndexForCase(testCase);
    const tokens = tokenize(testCase.query);
    const operator = testCase.operator === "or" ? "or" : "and";
    const matches = buildCandidates(index)
      .filter((candidate) => textMatches(candidate.text, tokens, operator))
      .map((candidate) => ({
        ...candidate,
        score: matchScore(candidate.text, tokens),
      }))
      .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), "ja"));
    const expectedHit = matches.find((candidate) => candidateMatchesExpected(candidate, testCase.expected ?? {}));
    results.push({
      id: testCase.id,
      city: testCase.city,
      query: testCase.query,
      ok: Boolean(expectedHit),
      expected: testCase.expected,
      hit: expectedHit
        ? {
            source: expectedHit.source,
            council_id: expectedHit.council_id ?? null,
            session_id: expectedHit.session_id ?? null,
            member_name: expectedHit.member_name ?? null,
            title: expectedHit.title,
          }
        : null,
      top: matches.slice(0, 3).map((candidate) => ({
        source: candidate.source,
        council_id: candidate.council_id ?? null,
        session_id: candidate.session_id ?? null,
        member_name: candidate.member_name ?? null,
        title: candidate.title,
        score: candidate.score,
      })),
      indexPath: path.relative(SITE_DIR, indexPath),
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  } else {
    for (const result of results) {
      const status = result.ok ? "PASS" : "FAIL";
      console.log(`${status} ${result.id}: ${result.query}`);
      if (result.hit) {
        console.log(`  hit: ${result.hit.source} ${result.hit.title}`);
      } else {
        console.log("  expected hit not found");
        for (const candidate of result.top) {
          console.log(`  top: ${candidate.source} ${candidate.title}`);
        }
      }
    }
    const pass = results.filter((result) => result.ok).length;
    console.log(`\nsearch quality: ${pass}/${results.length} passed`);
  }

  if (!results.every((result) => result.ok)) {
    process.exitCode = 1;
  }
}

main();
