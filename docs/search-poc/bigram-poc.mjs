#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..", "..");
const SITE_DIR = path.join(REPO_DIR, "site");
const INDEX_DIR = path.join(SITE_DIR, "public", "generated", "search-indexes");
const QUALITY_CASES_FILE = path.join(SITE_DIR, "data", "search_quality_cases.json");
const REPORT_FILE = path.join(__dirname, "bigram-poc-report.md");
const REQUIRED_CITIES = ["chitose", "eniwa", "tomakomai"];
const HEAVY_CITY_COUNT = 5;
const QUERY_FIXTURES = [
  "除雪",
  "防災",
  "給食",
  "小川陽平",
  "スケート学習",
  "ラピダス",
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function gzipLength(value) {
  return zlib.gzipSync(JSON.stringify(value)).length;
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
  return normalizeForSearch(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(text) {
  const compact = compactForSearch(text);
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const terms = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    terms.push(compact.slice(i, i + 2));
  }
  return Array.from(new Set(terms));
}

function queryTerms(query) {
  return Array.from(
    new Set(
      String(query ?? "")
        .trim()
        .split(/\s+/)
        .flatMap((token) => bigrams(token))
    )
  );
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function topIndexCities() {
  const files = fs
    .readdirSync(INDEX_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(INDEX_DIR, file);
      return {
        slug: path.basename(file, ".json"),
        bytes: fs.statSync(filePath).size,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const selected = new Set(REQUIRED_CITIES);
  for (const city of files) {
    if (selected.size >= REQUIRED_CITIES.length + HEAVY_CITY_COUNT) break;
    selected.add(city.slug);
  }
  return files.filter((city) => selected.has(city.slug));
}

function pushDoc(docs, doc) {
  const text = cleanText([doc.title, doc.body, doc.metaText].filter(Boolean).join(" "));
  if (!text) return;
  docs.push({
    id: doc.id,
    source: doc.source,
    city: doc.city,
    cityName: doc.cityName,
    title: cleanText(doc.title),
    body: cleanText(doc.body).slice(0, 500),
    metaText: cleanText(doc.metaText),
    council_id: doc.council_id ?? null,
    member_name: doc.member_name ?? "",
    href: doc.href ?? "",
    searchText: text,
  });
}

function docsFromIndex(index) {
  const docs = [];

  for (const row of index.agendas ?? []) {
    pushDoc(docs, {
      id: `agenda:${row.city}:${row.council_id}:${row.schedule_index}:${row.first_minute_id ?? "x"}`,
      source: "agenda",
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      title: `${row.cityName} ${row.council_name} ${row.agenda_title}`,
      body: row.text,
      metaText: [row.year, row.date, row.schedule_name].join(" "),
      href: row.first_minute_id ? `/${row.city}/minutes/${row.council_id}` : `/${row.city}/minutes`,
    });
  }

  for (const row of index.memberActivities ?? []) {
    pushDoc(docs, {
      id: `member_activity:${row.city}:${row.member_name}:${row.council_id}`,
      source: "member_activity",
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      member_name: row.member_name,
      title: `${row.cityName} ${row.member_name} ${row.council_name}`,
      body: [...(row.summary_topics ?? []), ...(row.topics ?? [])].join("、"),
      metaText: row.year,
      href: `/${row.city}/minutes/${row.council_id}`,
    });
  }

  for (const row of index.members ?? []) {
    pushDoc(docs, {
      id: `member:${row.city}:${row.seat_number ?? row.name}`,
      source: "member",
      city: row.city,
      cityName: row.cityName,
      member_name: row.name,
      title: `${row.cityName} ${row.name}`,
      body: [row.furigana, row.faction, ...(row.committees ?? [])].join(" "),
      metaText: row.seat_number ? `${row.seat_number}番` : "",
      href: Number.isFinite(row.seat_number) ? `/${row.city}/members/${row.seat_number}` : `/${row.city}`,
    });
  }

  for (const row of index.sessions ?? []) {
    for (const segment of row.segments ?? []) {
      pushDoc(docs, {
        id: `session:${row.city}:${row.id}:${segment.index}`,
        source: "session",
        city: row.city,
        cityName: row.cityName,
        title: `${row.cityName} ${row.title} ${segment.label}`,
        body: [segment.summary, ...(segment.topics ?? []), segment.transcript].join(" "),
        metaText: [row.date, row.committee, segment.start_time].join(" "),
        href: `/${row.city}/sessions/${row.id}`,
      });
    }
  }

  for (const row of index.enriched ?? []) {
    pushDoc(docs, {
      id: `enriched:${row.city}:${row.council_id}`,
      source: "enriched",
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      title: `${row.cityName} ${row.name}`,
      body: [row.summary, ...(row.highlights ?? []), ...(row.tags ?? [])].join(" "),
      metaText: row.generated_at,
      href: `/${row.city}/minutes/${row.council_id}`,
    });
  }

  for (const [indexNumber, row] of (index.decisions ?? []).entries()) {
    pushDoc(docs, {
      id: `decision:${row.city}:${indexNumber}`,
      source: "decision",
      city: row.city,
      cityName: row.cityName,
      title: `${row.cityName} ${row.session}`,
      body: row.description,
      href: `/${row.city}/decisions`,
    });
  }

  return docs;
}

function buildIndex(docs) {
  const postings = new Map();
  docs.forEach((doc, docIndex) => {
    for (const term of bigrams(doc.searchText)) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(docIndex);
    }
  });

  const shards = new Map();
  for (const [term, docIds] of postings.entries()) {
    const shardKey = term.slice(0, 1);
    if (!shards.has(shardKey)) shards.set(shardKey, {});
    shards.get(shardKey)[term] = docIds;
  }

  return {
    postings,
    shards,
  };
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function union(arrays) {
  return Array.from(new Set(arrays.flat()));
}

function search(index, docs, query, operator = "and") {
  const terms = queryTerms(query);
  if (!terms.length) return { terms, candidates: [], results: [] };
  const lists = terms.map((term) => index.postings.get(term) ?? []);
  const candidates = operator === "or" ? union(lists) : lists.reduce((acc, list) => intersect(acc, list));
  const normalizedQuery = compactForSearch(query);
  const scored = candidates
    .map((docIndex) => {
      const doc = docs[docIndex];
      const compactTitle = compactForSearch(doc.title);
      const compactText = compactForSearch(doc.searchText);
      const matchedTerms = terms.filter((term) => compactText.includes(term));
      const exactBoost = normalizedQuery && compactText.includes(normalizedQuery) ? 1000 : 0;
      const titleBoost = terms.filter((term) => compactTitle.includes(term)).length * 120;
      const sourceBoost = doc.source === "member" ? 60 : doc.source === "member_activity" ? 40 : 0;
      return {
        doc,
        score: exactBoost + titleBoost + matchedTerms.length * 20 + sourceBoost,
        matchedTerms,
      };
    })
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, "ja"));
  return { terms, candidates, results: scored };
}

function expectedMatches(doc, expected) {
  if (expected.source && doc.source !== expected.source) return false;
  if (expected.council_id && doc.council_id !== expected.council_id) return false;
  if (expected.member_name && compactForSearch(doc.member_name) !== compactForSearch(expected.member_name)) return false;
  if (Array.isArray(expected.textIncludes)) {
    const haystack = [doc.title, doc.body, doc.metaText].join(" ");
    return expected.textIncludes.every((text) => compactForSearch(haystack).includes(compactForSearch(text)));
  }
  return true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function compactReportText(text, maxLength = 72) {
  const value = cleanText(text).replace(/\|/g, "｜");
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function resultLabel(result) {
  if (!result) return "-";
  return `${result.source}: ${compactReportText(result.title)}`;
}

function makeReport(metrics) {
  const lines = [];
  lines.push("# Bigram検索PoCレポート");
  lines.push("");
  lines.push(`生成日: ${metrics.generated_at}`);
  lines.push("");
  lines.push("## 対象");
  lines.push("");
  lines.push(`- 対象自治体: ${metrics.cities.map((city) => `${city.slug} (${formatBytes(city.bytes)})`).join(" / ")}`);
  lines.push(`- ドキュメント数: ${metrics.document_count.toLocaleString()}`);
  lines.push(`- bigram語数: ${metrics.term_count.toLocaleString()}`);
  lines.push(`- シャード数: ${metrics.shard_count.toLocaleString()}`);
  lines.push("");
  lines.push("## サイズ");
  lines.push("");
  lines.push("| 項目 | JSON | gzip |");
  lines.push("|---|---:|---:|");
  lines.push(`| ドキュメントストア | ${formatBytes(metrics.sizes.documents_json)} | ${formatBytes(metrics.sizes.documents_gzip)} |`);
  lines.push(`| postings全体 | ${formatBytes(metrics.sizes.postings_json)} | ${formatBytes(metrics.sizes.postings_gzip)} |`);
  lines.push(`| 最大postingシャード | ${metrics.sizes.largest_shard.key} / ${formatBytes(metrics.sizes.largest_shard.json)} | ${formatBytes(metrics.sizes.largest_shard.gzip)} |`);
  lines.push("");
  lines.push("## クエリ別の推定転送量");
  lines.push("");
  lines.push("| クエリ | terms | 候補数 | posting shard gzip | 上位20件 payload gzip | 1位 |");
  lines.push("|---|---:|---:|---:|---:|---|");
  for (const row of metrics.queries) {
    lines.push(`| ${row.query} | ${row.terms.length} | ${row.candidate_count.toLocaleString()} | ${formatBytes(row.posting_shard_gzip)} | ${formatBytes(row.top_payload_gzip)} | ${resultLabel(row.top)} |`);
  }
  lines.push("");
  lines.push("## 正解台帳チェック");
  lines.push("");
  lines.push("| ケース | 結果 | 期待 | 1位 |");
  lines.push("|---|---|---|---|");
  for (const row of metrics.quality) {
    lines.push(`| ${row.id} | ${row.passed ? "PASS" : "FAIL"} | ${row.expected} | ${resultLabel(row.top)} |`);
  }
  lines.push("");
  lines.push("## 判定");
  lines.push("");
  lines.push(metrics.conclusion);
  lines.push("");
  lines.push("## 次の作業");
  lines.push("");
  lines.push("- 実装済みの市内検索bigram候補取得を、実機スマホと本番ログで継続確認する。");
  lines.push("- 全道横断検索はまだ置き換えない。市別候補の合流設計を追加してから扱う。");
  lines.push("- 実装前後は `search_quality_cases.json` の16件を必ず通す。千歳は実装中に追加ケースを増やす。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const writeReport = process.argv.includes("--write-report");
  const cities = topIndexCities();
  const docs = cities.flatMap(({ slug }) => docsFromIndex(readJson(path.join(INDEX_DIR, `${slug}.json`), {})));
  const searchIndex = buildIndex(docs);
  const postingsObject = Object.fromEntries(
    Array.from(searchIndex.postings.entries()).sort(([a], [b]) => a.localeCompare(b))
  );
  const docStore = docs.map(({ searchText, ...doc }) => doc);
  const shardMetrics = Array.from(searchIndex.shards.entries()).map(([key, value]) => ({
    key,
    json: byteLength(value),
    gzip: gzipLength(value),
  }));
  const largestShard = shardMetrics.sort((a, b) => b.gzip - a.gzip)[0] ?? { key: "-", json: 0, gzip: 0 };
  const queries = QUERY_FIXTURES.map((query) => {
    const result = search(searchIndex, docs, query, "and");
    const shardKeys = Array.from(new Set(result.terms.map((term) => term.slice(0, 1))));
    const postingShardGzip = shardKeys.reduce((sum, key) => sum + gzipLength(searchIndex.shards.get(key) ?? {}), 0);
    const topDocs = result.results.slice(0, 20).map(({ doc, score, matchedTerms }) => ({
      id: doc.id,
      source: doc.source,
      city: doc.city,
      cityName: doc.cityName,
      title: doc.title,
      body: doc.body,
      href: doc.href,
      score,
      matchedTerms,
    }));
    return {
      query,
      terms: result.terms,
      candidate_count: result.candidates.length,
      posting_shard_gzip: postingShardGzip,
      top_payload_gzip: gzipLength(topDocs),
      top: topDocs[0] ?? null,
    };
  });

  const qualityCases = readJson(QUALITY_CASES_FILE, []).filter((testCase) =>
    cities.some((city) => city.slug === testCase.city)
  );
  const quality = qualityCases.map((testCase) => {
    const result = search(searchIndex, docs, testCase.query, testCase.operator === "or" ? "or" : "and");
    const matched = result.results.find(({ doc }) => expectedMatches(doc, testCase.expected));
    const top = result.results[0]?.doc ?? null;
    return {
      id: testCase.id,
      query: testCase.query,
      passed: Boolean(matched),
      expected: [testCase.expected.source, testCase.expected.council_id, testCase.expected.member_name].filter(Boolean).join(" / "),
      top: top ? { source: top.source, title: top.title } : null,
    };
  });

  const maxPostingGzip = Math.max(...queries.map((row) => row.posting_shard_gzip));
  const qualityPassed = quality.filter((row) => row.passed).length;
  const conclusion =
    qualityPassed === quality.length && maxPostingGzip < 500 * 1024
      ? `PoC対象では正解台帳 ${qualityPassed}/${quality.length} 件が通り、クエリに必要なposting shardも最大 ${formatBytes(maxPostingGzip)} に収まった。市内検索から段階導入する価値がある。`
      : `PoC対象では正解台帳 ${qualityPassed}/${quality.length} 件、最大posting shard ${formatBytes(maxPostingGzip)}。本番導入前に語彙・シャード設計の調整が必要。`;

  const metrics = {
    generated_at: new Date().toISOString(),
    cities,
    document_count: docs.length,
    term_count: searchIndex.postings.size,
    shard_count: searchIndex.shards.size,
    sizes: {
      documents_json: byteLength(docStore),
      documents_gzip: gzipLength(docStore),
      postings_json: byteLength(postingsObject),
      postings_gzip: gzipLength(postingsObject),
      largest_shard: largestShard,
    },
    queries,
    quality,
    conclusion,
  };

  const report = makeReport(metrics);
  if (writeReport) {
    fs.mkdirSync(__dirname, { recursive: true });
    fs.writeFileSync(REPORT_FILE, report);
  }
  process.stdout.write(report);
}

main();
