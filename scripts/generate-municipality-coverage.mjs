#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "data");
const DOC_PATH = path.join(REPO_ROOT, "docs", "municipality-coverage.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function hasMinutesData(cityDir) {
  const candidates = [
    path.join(cityDir, "minutes", "index.json"),
    path.join(cityDir, "index.json"),
  ];
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    try {
      const data = readJson(candidate);
      if (Array.isArray(data) && data.length > 0) return true;
    } catch {}
  }
  return false;
}

function hasThemesData(cityDir) {
  const fp = path.join(cityDir, "members_activity.json");
  if (!exists(fp)) return false;
  try {
    const data = readJson(fp);
    return data && Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

function hasSegmentsData(cityDir) {
  const fp = path.join(cityDir, "segments", "_index.json");
  if (!exists(fp)) return false;
  try {
    const data = readJson(fp);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

function hasQuestionMemberSegments(cityDir) {
  const fp = path.join(cityDir, "segments", "_index.json");
  if (!exists(fp)) return false;
  try {
    const data = readJson(fp);
    return Array.isArray(data) && data.some((item) => item.speaker_role === "質問" && item.member_name);
  } catch {
    return false;
  }
}

function hasQuestionSegments(cityDir) {
  const fp = path.join(cityDir, "segments", "_index.json");
  if (!exists(fp)) return false;
  try {
    const data = readJson(fp);
    return Array.isArray(data) && data.some((item) => item.speaker_role === "質問");
  } catch {
    return false;
  }
}

function mark(value) {
  return value ? "○" : "—";
}

function normalizeName(text) {
  return String(text ?? "").replace(/[\s\u3000]/g, "");
}

function readFirstMinutesSample(cityDir) {
  const indexCandidates = [
    path.join(cityDir, "minutes", "index.json"),
    path.join(cityDir, "index.json"),
  ];

  for (const indexPath of indexCandidates) {
    if (!exists(indexPath)) continue;
    try {
      const index = readJson(indexPath);
      if (!Array.isArray(index) || index.length === 0) continue;
      const item = index[0];
      const fileCandidates = [
        path.join(cityDir, "minutes", item.file ?? `${item.council_id}.json`),
        path.join(cityDir, item.file ?? `${item.council_id}.json`),
      ];
      const src = fileCandidates.find((candidate) => exists(candidate));
      if (!src) continue;
      return JSON.stringify(readJson(src)).slice(0, 12000);
    } catch {}
  }

  return "";
}

function detectSourceMismatch(entry, cityDir, files) {
  if (!files.minutes) return "";

  const sample = readFirstMinutesSample(cityDir);
  if (!sample) return "";

  const normalized = normalizeName(sample);
  const expectedNames = [entry.name, entry.council_name]
    .map((value) => normalizeName(value))
    .filter(Boolean);

  if (expectedNames.some((value) => normalized.includes(value))) {
    return "";
  }

  const municipalityMatches = Array.from(
    new Set(
      [...sample.matchAll(/([一-龠々ぁ-んァ-ヶA-Za-z]+(?:市|町|村))(?:議会|長|役場)?/g)]
        .map((match) => match[1])
        .filter((value) => value.length >= 2)
    )
  );
  const alternative = municipalityMatches.find((value) => !expectedNames.includes(normalizeName(value)));
  return Boolean(alternative);
}

function classifyParserIssue(entry, cityDir, files) {
  const mismatch = detectSourceMismatch(entry, cityDir, files);
  if (mismatch) return "source mismatch";
  if (!files.minutes || files.themes) return "";
  if (!files.members) return "議員名簿未整備";
  if (files.segments && hasQuestionMemberSegments(cityDir)) return "themes 名寄せ調整";
  if (files.segments && hasQuestionSegments(cityDir)) return "議員名簿ミスマッチ";
  if (files.segments) return "質問者抽出不足";

  const sample = readFirstMinutesSample(cityDir);
  if (entry.system === "gijiroku_com") return "gijiroku_com 本文解析";
  if (entry.system === "pdf_inhouse") return "PDF会議録 本文解析";
  if (entry.system === "html_inhouse") return "HTML会議録 本文解析";
  if (/\[[^\]]+\]/.test(sample) || /○議長/.test(sample) || /[0-9０-９]+番[^\n]{0,12}議員/.test(sample)) {
    return "会議録本文 ルール追加";
  }
  return "raw 形式の棚卸し";
}

function nextAction(entry, files, parserIssue) {
  if (!files.members) return "議員一覧の整備";
  if (parserIssue === "source mismatch") {
    return "tenant_id/source の見直し";
  }
  if (!files.minutes && entry.minutes_status === "unavailable") {
    return "議事録未公開の確認更新";
  }
  if (!files.minutes) return "議事録導線の可否判断";
  if (parserIssue === "議員名簿ミスマッチ") {
    return "members.json の見直し";
  }
  if (parserIssue === "gijiroku_com 本文解析") {
    return "gijiroku_com 系の変換改善";
  }
  if (parserIssue === "PDF会議録 本文解析" || parserIssue === "HTML会議録 本文解析" || parserIssue === "会議録本文 ルール追加") {
    return "会議録本文の変換改善";
  }
  if (parserIssue === "raw 形式の棚卸し") {
    return "raw 形式の棚卸し";
  }
  if (files.members && files.minutes && !files.segments) {
    return "raw 議事録の変換改善";
  }
  if (files.members && files.minutes && files.segments && !files.themes) {
    return "themes 名寄せ調整";
  }
  if (files.members && files.minutes && !files.themes) {
    return "テーマ別データ作成";
  }
  return "追加優先度は低め";
}

function buildRow(entry) {
  const cityDir = path.join(DATA_DIR, entry.slug);
  const files = {
    members: exists(path.join(cityDir, "members.json")),
    minutes: hasMinutesData(cityDir),
    segments: hasSegmentsData(cityDir),
    themes: hasThemesData(cityDir),
    election: exists(path.join(cityDir, "election.json")),
    sessions: exists(path.join(cityDir, "sessions", "index.json")),
    decisions: exists(path.join(cityDir, "decisions.json")),
    schedule: exists(path.join(cityDir, "schedule.json")),
    newsletter: exists(path.join(cityDir, "newsletter.json")),
    plan: exists(path.join(cityDir, "comprehensive_plan.json")),
  };
  const parserIssue = classifyParserIssue(entry, cityDir, files);

  return {
    region: entry.region,
    slug: entry.slug,
    name: entry.name,
    files,
    system: entry.system ?? "",
    parserIssue,
    next: nextAction(entry, files, parserIssue),
    minutesStatus:
      entry.minutes_status === "unavailable"
        ? `未公開確認済み (${entry.minutes_verified_at ?? "日付未記録"})`
        : files.minutes
          ? "掲載中"
          : "未整備",
  };
}

function summary(rows) {
  const total = rows.length;
  const count = (key) => rows.filter((row) => row.files[key]).length;
  return {
    total,
    members: count("members"),
    minutes: count("minutes"),
    segments: count("segments"),
    themes: count("themes"),
    election: count("election"),
    sessions: count("sessions"),
    decisions: count("decisions"),
    schedule: count("schedule"),
    newsletter: count("newsletter"),
    plan: count("plan"),
  };
}

function topPriorities(rows) {
  const missingMembersAndMinutes = rows.filter((row) => !row.files.members && !row.files.minutes).length;
  const membersOnly = rows.filter((row) => row.files.members && !row.files.minutes).length;
  const minutesWithoutThemesReady = rows.filter((row) => row.files.members && row.files.minutes && row.parserIssue === "themes 名寄せ調整").length;
  const minutesWithoutThemesNeedParser = rows.filter((row) => row.files.members && row.files.minutes && !row.files.segments && !row.files.themes).length;
  const minutesWithoutThemesNeedMembers = rows.filter((row) => !row.files.members && row.files.minutes && !row.files.themes).length;
  const themeReady = rows.filter((row) => row.files.themes).length;
  return {
    missingMembersAndMinutes,
    membersOnly,
    minutesWithoutThemesReady,
    minutesWithoutThemesNeedParser,
    minutesWithoutThemesNeedMembers,
    themeReady,
  };
}

function parserIssueSummary(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!row.parserIssue) continue;
    counts.set(row.parserIssue, (counts.get(row.parserIssue) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function main() {
  const municipalities = readJson(path.join(DATA_DIR, "municipalities.json"))
    .filter((entry) => entry.active)
    .sort((a, b) => a.region.localeCompare(b.region, "ja") || a.name.localeCompare(b.name, "ja"));

  const rows = municipalities.map(buildRow);
  const sums = summary(rows);
  const priorities = topPriorities(rows);
  const parserIssues = parserIssueSummary(rows);

  const generatedDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const lines = [];
  lines.push("# 市町村機能充足一覧");
  lines.push("");
  lines.push(`生成日: ${generatedDate}`);
  lines.push("");
  lines.push("## サマリー");
  lines.push("");
  lines.push(`- 対象自治体: ${sums.total}`);
  lines.push(`- 議員一覧あり: ${sums.members}`);
  lines.push(`- 議事録あり: ${sums.minutes}`);
  lines.push(`- segments あり: ${sums.segments}`);
  lines.push(`- テーマ別データあり: ${sums.themes}`);
  lines.push(`- 選挙結果あり: ${sums.election}`);
  lines.push(`- 会議録・速報あり: ${sums.sessions}`);
  lines.push(`- 議決結果あり: ${sums.decisions}`);
  lines.push(`- 行事予定あり: ${sums.schedule}`);
  lines.push(`- 議会だよりあり: ${sums.newsletter}`);
  lines.push(`- 総合計画あり: ${sums.plan}`);
  lines.push("");
  lines.push("## 企画上の優先観点");
  lines.push("");
  lines.push(`- 議員一覧も議事録も未整備: ${priorities.missingMembersAndMinutes}`);
  lines.push(`- 議員一覧のみ掲載中: ${priorities.membersOnly}`);
  lines.push(`- 議事録と segments はあるがテーマ別未整備: ${priorities.minutesWithoutThemesReady}`);
  lines.push(`- 議事録はあるが raw 変換改善が必要: ${priorities.minutesWithoutThemesNeedParser}`);
  lines.push(`- 議事録はあるが議員名簿が未整備: ${priorities.minutesWithoutThemesNeedMembers}`);
  lines.push(`- テーマ別データ整備済み: ${priorities.themeReady}`);
  lines.push("");
  lines.push("## 変換課題の内訳");
  lines.push("");
  if (parserIssues.length === 0) {
    lines.push("- なし");
  } else {
    for (const [label, count] of parserIssues) {
      lines.push(`- ${label}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## 一覧");
  lines.push("");
  lines.push("| 地域 | 自治体 | slug | 議員 | 議事録 | segments | themes | 選挙 | 会議録 | 議決 | 行事 | だより | 総合計画 | 変換課題 | 議事録状況 | 次の一手 |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.region} | ${row.name} | ${row.slug} | ${mark(row.files.members)} | ${mark(row.files.minutes)} | ${mark(row.files.segments)} | ${mark(row.files.themes)} | ${mark(row.files.election)} | ${mark(row.files.sessions)} | ${mark(row.files.decisions)} | ${mark(row.files.schedule)} | ${mark(row.files.newsletter)} | ${mark(row.files.plan)} | ${row.parserIssue || "—"} | ${row.minutesStatus} | ${row.next} |`
    );
  }
  lines.push("");
  lines.push("## 判定ルール");
  lines.push("");
  lines.push("- `議員`: `data/{slug}/members.json` がある");
  lines.push("- `議事録`: `data/{slug}/minutes/index.json` または `data/{slug}/index.json` がある");
  lines.push("- `segments`: `data/{slug}/segments/_index.json` があり、かつ空ではない");
  lines.push("- `themes`: `data/{slug}/members_activity.json` があり、かつ空ではない");
  lines.push("- `会議録`: `data/{slug}/sessions/index.json` がある");
  lines.push("- `議事録状況`: `minutes_status` と実ファイルの両方を見て表示");
  lines.push("- 機能の公開可否は `site/scripts/build-city-capabilities.mjs` で生成する台帳に寄せる。`municipalities.json` の旧 `features` は判定に使わない。");

  fs.writeFileSync(DOC_PATH, `${lines.join("\n")}\n`, "utf-8");
  console.log(`wrote ${path.relative(REPO_ROOT, DOC_PATH)}`);
}

main();
