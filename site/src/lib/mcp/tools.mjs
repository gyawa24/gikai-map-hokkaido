// gikai MCP のツール定義。stdio版（mcp-server/index.mjs）と
// HTTP版（site/src/app/api/mcp/route.ts）の両方からこれを呼ぶ。
//
// dataDir 以下に _search-index.json / municipalities.json と
// {slug}/minutes/{id}.json などが揃っている前提。
// Vercel deploy では process.cwd()/data がここを指す。
// stdio ローカル実行では <repo>/site/data がここを指す。
//
// includeRestricted=false（HTTP配布版）では _restricted-index.json を読まない。
// 札幌市など restricted 自治体のデータは「stdio個人利用＝著作権30条の私的使用」で
// ギリギリ成立しているため、配布した瞬間にこの整理が崩れる。

import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const PUBLIC_BASE = "https://chihougikai.com";

function tokenize(q) {
  return q.trim().split(/\s+/).filter(Boolean);
}
function matchesAll(text, tokens) {
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t.toLowerCase()));
}
function excerpt(text, tokens, radius = 80) {
  const first = tokens[0] ?? "";
  const idx = text.toLowerCase().indexOf(first.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + first.length + radius);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end) +
    (end < text.length ? "…" : "")
  );
}
function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * @param {object} server  McpServer インスタンス
 * @param {object} options
 * @param {string} options.dataDir            data/ ディレクトリ絶対パス
 * @param {string} [options.restrictedIndexPath]  指定された場合のみ restricted を merge する（stdio個人利用専用）
 * @param {string} [options.segmentsDir]       segments/ を含む別ディレクトリ（指定時のみ search_segments を登録 — stdio専用）
 */
export function registerTools(server, options) {
  const { dataDir, restrictedIndexPath, segmentsDir } = options;
  const SEARCH_INDEX_PATH = path.join(dataDir, "_search-index.json");
  const MUNICIPALITIES_PATH = path.join(dataDir, "municipalities.json");

  let _municipalities = null;
  function getMunicipalities() {
    if (_municipalities) return _municipalities;
    _municipalities = JSON.parse(fs.readFileSync(MUNICIPALITIES_PATH, "utf-8"));
    return _municipalities;
  }
  function getCityName(slug) {
    return getMunicipalities().find((m) => m.slug === slug)?.name ?? slug;
  }
  function getActiveMunicipality(slug) {
    return getMunicipalities().find((m) => m.slug === slug && m.active) ?? null;
  }
  function isSafeFileToken(value) {
    return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value);
  }

  let _searchIndex = null;
  function getSearchIndex() {
    if (_searchIndex) return _searchIndex;
    if (!fs.existsSync(SEARCH_INDEX_PATH)) {
      throw new Error(
        `_search-index.json が見つかりません: ${SEARCH_INDEX_PATH}\n` +
          `先に site/ で 'npm run build-search-index' を実行してから再起動してください。`
      );
    }
    _searchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, "utf-8"));
    return _searchIndex;
  }

  let _restrictedAgendas = null;
  function getRestrictedAgendas() {
    if (!restrictedIndexPath) return [];
    if (_restrictedAgendas !== null) return _restrictedAgendas;
    if (!fs.existsSync(restrictedIndexPath)) {
      _restrictedAgendas = [];
      return _restrictedAgendas;
    }
    try {
      const data = JSON.parse(fs.readFileSync(restrictedIndexPath, "utf-8"));
      _restrictedAgendas = data.agendas ?? [];
    } catch {
      _restrictedAgendas = [];
    }
    return _restrictedAgendas;
  }

  // Tool 1 ───────────────────────────────────────────────────────────────────
  server.tool(
    "list_municipalities",
    "北海道179市町村の一覧を返す。region・機能・active状態で絞り込み可能。横断分析の対象選定に使う。",
    {
      region: z
        .string()
        .optional()
        .describe("振興局名（例: 石狩、上川、十勝、胆振）。指定すると該当地域のみ"),
      has_feature: z
        .enum(["members", "minutes", "sessions", "decisions", "newsletter"])
        .optional()
        .describe("指定機能を持つ自治体のみに絞る"),
      active_only: z
        .boolean()
        .optional()
        .default(true)
        .describe("active=trueの自治体のみ。デフォルトtrue"),
    },
    async ({ region, has_feature, active_only }) => {
      let list = getMunicipalities();
      if (active_only) list = list.filter((m) => m.active);
      if (region) list = list.filter((m) => m.region === region);
      if (has_feature)
        list = list.filter((m) => (m.features ?? []).includes(has_feature));
      const result = list.map((m) => ({
        slug: m.slug,
        name: m.name,
        council_name: m.council_name,
        region: m.region,
        features: m.features ?? [],
        system: m.system ?? null,
        level: m.level ?? null,
        url: `${PUBLIC_BASE}/${m.slug}`,
      }));
      return ok({ count: result.length, municipalities: result });
    }
  );

  // Tool 2 ───────────────────────────────────────────────────────────────────
  server.tool(
    "search_minutes",
    "北海道全市町村の議事録を横断キーワード検索する（議題単位）。スペース区切りで複数語のAND検索。" +
      "結果には引用根拠URLが含まれる — 分析結果を出すときは必ず併記すること。",
    {
      query: z
        .string()
        .min(1)
        .describe("検索キーワード。空白区切りで複数指定可（例: '介護保険 値上げ'）"),
      cities: z
        .array(z.string())
        .optional()
        .describe("市町村slug配列（例: ['chitose','asahikawa']）。省略時は全市"),
      year_from: z.number().int().optional().describe("西暦下限（含む）"),
      year_to: z.number().int().optional().describe("西暦上限（含む）"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(30)
        .describe("最大件数。デフォルト30"),
    },
    async ({ query, cities, year_from, year_to, limit }) => {
      const tokens = tokenize(query);
      if (!tokens.length) return ok({ hits: [], total: 0 });
      const index = getSearchIndex();
      const cityFilter = cities && cities.length ? new Set(cities) : null;

      const hits = [];
      let total = 0;
      const cityCounts = {};
      const allAgendas = [...index.agendas, ...getRestrictedAgendas()];
      for (const a of allAgendas) {
        if (cityFilter && !cityFilter.has(a.city)) continue;
        const yearNum = a.year ? Number(a.year) : null;
        if (year_from && yearNum && yearNum < year_from) continue;
        if (year_to && yearNum && yearNum > year_to) continue;
        const haystack = `${a.agenda_title} ${a.text}`;
        if (!matchesAll(haystack, tokens)) continue;
        total++;
        cityCounts[a.city] = (cityCounts[a.city] ?? 0) + 1;
        if (hits.length < limit) {
          hits.push({
            city: a.city,
            city_name: a.cityName,
            council_id: a.council_id,
            council_name: a.council_name,
            schedule_index: a.schedule_index,
            schedule_name: a.schedule_name,
            agenda_title: a.agenda_title || null,
            first_minute_id: a.first_minute_id,
            year: a.year || null,
            excerpt: excerpt(haystack, tokens),
            url: `${PUBLIC_BASE}/${a.city}/minutes/${a.council_id}?q=${encodeURIComponent(query)}`,
          });
        }
      }

      return ok({
        query,
        total_hits: total,
        returned: hits.length,
        by_city: cityCounts,
        hits,
        note:
          "結論を出すときは hits[].url を引用根拠として併記すること。" +
          "発言の意図や賛否を断定する前に get_minutes_excerpt で原文を確認すること。",
      });
    }
  );

  // Tool 3 ───────────────────────────────────────────────────────────────────
  server.tool(
    "search_members",
    "議員を横断検索する。名前・読み仮名・会派・委員会で部分一致。",
    {
      query: z.string().min(1).describe("検索キーワード（名前・会派など）"),
      cities: z
        .array(z.string())
        .optional()
        .describe("市町村slug配列。省略時は全市"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("最大件数。デフォルト50"),
    },
    async ({ query, cities, limit }) => {
      const tokens = tokenize(query);
      const munis = getMunicipalities().filter((m) => m.active);
      const cityFilter = cities && cities.length ? new Set(cities) : null;
      const targets = cityFilter
        ? munis.filter((m) => cityFilter.has(m.slug))
        : munis;

      const results = [];
      for (const m of targets) {
        const fp = path.join(dataDir, m.slug, "members.json");
        if (!fs.existsSync(fp)) continue;
        let list;
        try {
          list = JSON.parse(fs.readFileSync(fp, "utf-8"));
        } catch {
          continue;
        }
        if (!Array.isArray(list)) continue;
        for (const member of list) {
          const committees = Array.isArray(member.committees)
            ? member.committees
            : [];
          const haystack = [
            member.name ?? "",
            member.furigana ?? "",
            member.party ?? "",
            member.faction ?? "",
            ...committees,
          ].join(" ");
          if (!matchesAll(haystack, tokens)) continue;
          results.push({
            city: m.slug,
            city_name: m.name,
            name: member.name ?? "",
            furigana: member.furigana ?? "",
            party: member.party ?? "",
            faction: member.faction ?? "",
            committees,
            seat_number: member.seat_number ?? null,
            url: `${PUBLIC_BASE}/${m.slug}`,
          });
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
      return ok({ query, returned: results.length, members: results });
    }
  );

  // Tool 4 ───────────────────────────────────────────────────────────────────
  server.tool(
    "get_minutes_excerpt",
    "議事録の本文を会議ID単位で取得する。schedule_index・around_minute_id で特定箇所に絞れる。max_charsで切り詰め。",
    {
      city: z.string().describe("市町村slug（例: chitose）"),
      council_id: z
        .number()
        .int()
        .describe("会議ID（search_minutesの結果のcouncil_id）"),
      schedule_index: z
        .number()
        .int()
        .optional()
        .describe("日次index。省略時は全日程"),
      around_minute_id: z
        .number()
        .int()
        .optional()
        .describe("この発言ID付近のみ抽出（前2件・後8件）"),
      max_chars: z
        .number()
        .int()
        .min(500)
        .max(50000)
        .default(8000)
        .describe("最大文字数。デフォルト8000"),
    },
    async ({ city, council_id, schedule_index, around_minute_id, max_chars }) => {
      if (!getActiveMunicipality(city)) {
        return ok({ error: `unknown_city: ${city}` });
      }
      const fp = path.join(dataDir, city, "minutes", `${council_id}.json`);
      if (!fs.existsSync(fp))
        return ok({
          error: `not_bundled: ${city}/minutes/${council_id}`,
          note:
            "この議事録本文はMCPのFunctionバンドルに含まれていません" +
            "（Vercel 250MB制限のため運用3市=chitose/eniwa/tomakomaiに限定）。" +
            "search_minutes の excerpt（80字前後）を引用根拠とするか、" +
            "下記URLをユーザーに案内してください。",
          url: `${PUBLIC_BASE}/${city}/minutes/${council_id}`,
        });
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const schedules = Array.isArray(data.schedules) ? data.schedules : [];
      const targetSchedules =
        schedule_index !== undefined
          ? schedules.filter((_, i) => i === schedule_index)
          : schedules;

      const blocks = [];
      let total = 0;
      let truncated = false;
      outer: for (const sched of targetSchedules) {
        const minutes = Array.isArray(sched.minutes) ? sched.minutes : [];
        let windowMinutes = minutes;
        if (around_minute_id !== undefined) {
          const idx = minutes.findIndex((m) => m.minute_id === around_minute_id);
          if (idx >= 0)
            windowMinutes = minutes.slice(Math.max(0, idx - 2), idx + 8);
        }
        blocks.push(`── ${sched.name ?? `schedule#${sched.schedule_id}`} ──`);
        for (const m of windowMinutes) {
          const line = `[${m.minute_type ?? ""}] ${m.title ?? ""}: ${(m.text ?? "").trim()}`;
          if (total + line.length > max_chars) {
            blocks.push("…（max_chars制限により以降省略）");
            truncated = true;
            break outer;
          }
          blocks.push(line);
          total += line.length;
        }
      }
      return ok({
        city,
        city_name: getCityName(city),
        council_id,
        council_name: data.name ?? "",
        year: data.year ?? "",
        schedule_count: schedules.length,
        truncated,
        url: `${PUBLIC_BASE}/${city}/minutes/${council_id}`,
        excerpt: blocks.join("\n\n"),
      });
    }
  );

  // Tool 5 ───────────────────────────────────────────────────────────────────
  server.tool(
    "get_session_segment",
    "動画セッションの文字起こし＋AI要約を取得する。" +
      "seg_indexで特定セグメントの要約・トピック・Q&Aを返す。",
    {
      city: z.string().describe("市町村slug（例: chitose, hokkaido）"),
      session_id: z
        .string()
        .describe("セッションID（例: r8-teireikai1-day1-20260302）"),
      seg_index: z
        .number()
        .int()
        .optional()
        .describe("セグメントindex。省略時は全セグメントの要約のみ返す"),
      include_transcript: z
        .boolean()
        .default(false)
        .describe("trueにすると原文文字起こしも返す（巨大）"),
    },
    async ({ city, session_id, seg_index, include_transcript }) => {
      if (!getActiveMunicipality(city)) {
        return ok({ error: `unknown_city: ${city}` });
      }
      if (!isSafeFileToken(session_id)) {
        return ok({ error: "invalid_session_id" });
      }
      const fp = path.join(dataDir, city, "sessions", `${session_id}.json`);
      if (!fs.existsSync(fp))
        return ok({ error: `not_found: data/${city}/sessions/${session_id}.json` });
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const segments = Array.isArray(data.segments) ? data.segments : [];
      const filtered =
        seg_index !== undefined
          ? segments.filter((s) => s.index === seg_index)
          : segments;
      const result = filtered.map((s) => ({
        index: s.index,
        label: s.label,
        start_time: s.start_time,
        end_time: s.end_time,
        summary: s.summary,
        topics: s.topics,
        detail: s.detail,
        transcript: include_transcript ? s.transcript : undefined,
      }));
      return ok({
        city,
        city_name: getCityName(city),
        session_id,
        title: data.title,
        date: data.date,
        committee: data.committee,
        youtube_id: data.youtube_id,
        source_type: data.source_type ?? (data.youtube_id ? "youtube" : "web"),
        source_url: data.source_url ?? null,
        source_label: data.source_label ?? null,
        source_thumbnail_url: data.source_thumbnail_url ?? null,
        segment_count: segments.length,
        url: `${PUBLIC_BASE}/${city}/sessions/${session_id}`,
        youtube_url: data.youtube_id
          ? `https://www.youtube.com/watch?v=${data.youtube_id}`
          : null,
        segments: result,
      });
    }
  );

  // 議事録は英数字を全角で記録することが多い（例: ＤＸ／ＡＩ／２０２５）。
  // 半角/全角差で hit を逃さないよう、segments 検索だけは正規化して比較する。
  function normalizeFullWidth(s) {
    return (s ?? "")
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0)
      );
  }
  function matchesAllNormalized(text, tokens) {
    const lower = normalizeFullWidth(text);
    return tokens.every((t) => lower.includes(normalizeFullWidth(t)));
  }

  // Tool 6 (stdio専用) ─────────────────────────────────────────────────────
  // segmentsDir が渡されたときだけ登録。HTTP配布版では使わない。
  if (segmentsDir) {
    const segmentIndexCache = new Map();
    function getSegmentIndex(slug) {
      if (segmentIndexCache.has(slug)) return segmentIndexCache.get(slug);
      const fp = path.join(segmentsDir, slug, "segments", "_index.json");
      if (!fs.existsSync(fp)) {
        segmentIndexCache.set(slug, []);
        return [];
      }
      try {
        const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
        const arr = Array.isArray(data) ? data : [];
        segmentIndexCache.set(slug, arr);
        return arr;
      } catch {
        segmentIndexCache.set(slug, []);
        return [];
      }
    }

    const councilSegmentsCache = new Map();
    function loadCouncilSegments(slug, councilId) {
      const key = `${slug}/${councilId}`;
      if (councilSegmentsCache.has(key)) return councilSegmentsCache.get(key);
      const fp = path.join(segmentsDir, slug, "segments", `${councilId}.json`);
      if (!fs.existsSync(fp)) {
        councilSegmentsCache.set(key, []);
        return [];
      }
      try {
        const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
        const arr = Array.isArray(data) ? data : [];
        councilSegmentsCache.set(key, arr);
        return arr;
      } catch {
        councilSegmentsCache.set(key, []);
        return [];
      }
    }

    function getSegmentFullText(slug, councilId, segmentId) {
      return (
        loadCouncilSegments(slug, councilId).find((s) => s.id === segmentId)
          ?.text ?? null
      );
    }

    server.tool(
      "search_segments",
      "議事録を発言（話者交代単位）で横断検索する。speaker/会派/役割/日付で絞り込み可能。" +
        "search_minutes が議題単位なのに対し、search_segments は1発言単位で粒度が細かい。" +
        "発言者の特定や、政党別・議員別の発言比較に使う。",
      {
        query: z
          .string()
          .optional()
          .describe(
            "検索キーワード。空白区切りで複数指定可（AND）。省略するとフィルタのみで絞り込み"
          ),
        cities: z
          .array(z.string())
          .optional()
          .describe("市町村slug配列。省略時は全市横断"),
        member_name: z
          .string()
          .optional()
          .describe(
            "議員名で絞り込み（部分一致）。member_name フィールドに対する検索"
          ),
        faction: z
          .string()
          .optional()
          .describe("会派/政党名で絞り込み（部分一致、例: '自民', '共産'）"),
        speaker_role: z
          .enum(["質問", "答弁"])
          .optional()
          .describe("発言の役割（質問 or 答弁）で絞り込み"),
        exclude_procedural: z
          .boolean()
          .default(true)
          .describe(
            "議長・委員長・事務局長などの進行発言を除外する。デフォルトtrue"
          ),
        date_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("日付下限 YYYY-MM-DD（含む）"),
        date_to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("日付上限 YYYY-MM-DD（含む）"),
        include_text: z
          .boolean()
          .default(false)
          .describe(
            "trueにすると発言全文も返す（excerpt より長い、token消費注意）"
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("最大件数。デフォルト20"),
      },
      async ({
        query,
        cities,
        member_name,
        faction,
        speaker_role,
        exclude_procedural,
        date_from,
        date_to,
        include_text,
        limit,
      }) => {
        const tokens = query ? tokenize(query) : [];
        const munis = getMunicipalities();
        const cityFilter = cities && cities.length ? new Set(cities) : null;
        const targetSlugs = cityFilter
          ? munis.filter((m) => cityFilter.has(m.slug)).map((m) => m.slug)
          : munis.map((m) => m.slug);

        const memberNameLower = member_name?.toLowerCase() ?? null;
        const factionLower = faction?.toLowerCase() ?? null;

        const hits = [];
        let total = 0;
        const cityCounts = {};

        for (const slug of targetSlugs) {
          const idx = getSegmentIndex(slug);
          if (!idx.length) continue;
          for (const seg of idx) {
            if (exclude_procedural && seg.is_procedural) continue;
            if (speaker_role && seg.speaker_role !== speaker_role) continue;
            if (date_from && seg.date && seg.date < date_from) continue;
            if (date_to && seg.date && seg.date > date_to) continue;
            if (
              memberNameLower &&
              !(seg.member_name ?? "").toLowerCase().includes(memberNameLower)
            )
              continue;
            if (
              factionLower &&
              !(seg.member_faction ?? "").toLowerCase().includes(factionLower)
            )
              continue;
            // Keyword match: try excerpt first (fast), fall back to full text
            // when excerpt doesn't match (excerpt is only ~100 chars).
            // Use normalized matcher so 半角/全角 英数字 are equivalent.
            if (tokens.length) {
              const speakerText = seg.speaker ?? "";
              const haystackExcerpt = `${speakerText} ${seg.excerpt ?? ""}`;
              if (!matchesAllNormalized(haystackExcerpt, tokens)) {
                const fullText = getSegmentFullText(slug, seg.council_id, seg.id);
                if (!fullText) continue;
                if (!matchesAllNormalized(`${speakerText} ${fullText}`, tokens))
                  continue;
              }
            }
            total++;
            cityCounts[slug] = (cityCounts[slug] ?? 0) + 1;
            if (hits.length < limit) {
              const hit = {
                id: seg.id,
                city: slug,
                city_name: getCityName(slug),
                council_id: seg.council_id,
                council_name: seg.council_name,
                date: seg.date,
                speaker: seg.speaker,
                speaker_role: seg.speaker_role,
                is_procedural: seg.is_procedural,
                member_name: seg.member_name,
                member_faction: seg.member_faction,
                excerpt: seg.excerpt,
                text_length: seg.text_length,
                url: `${PUBLIC_BASE}/${slug}/minutes/${seg.council_id}${
                  tokens.length ? `?q=${encodeURIComponent(query)}` : ""
                }`,
              };
              if (include_text) {
                hit.text = getSegmentFullText(slug, seg.council_id, seg.id);
              }
              hits.push(hit);
            }
          }
        }

        return ok({
          query: query ?? null,
          filters: {
            cities: cities ?? null,
            member_name: member_name ?? null,
            faction: faction ?? null,
            speaker_role: speaker_role ?? null,
            exclude_procedural,
            date_from: date_from ?? null,
            date_to: date_to ?? null,
          },
          total_hits: total,
          returned: hits.length,
          by_city: cityCounts,
          hits,
          note:
            "結論を出すときは hits[].url を引用根拠として併記すること。" +
            "発言の全文が必要なときは include_text=true にするか、" +
            "search_minutes / get_minutes_excerpt と組み合わせて文脈確認すること。",
        });
      }
    );
  }
}
