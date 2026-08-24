import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { compactForSearch } from "../../site/src/lib/searchNormalization.mjs";

import {
  agendaSearchDocumentId,
  buildRawCouncilFallbackText,
  classifyRawScheduleFallback,
  buildMinuteEvidenceBySchedule,
  evidenceOnlySessionSegment,
  excludedRawMinuteHasSubstantiveText,
  exactTextAssetValue,
  hasSubstantiveAgendaSearchText,
  minutesSearchIsRestricted,
  normalizeMinuteBodyForSearchEvidence,
  selectScheduleExactSource,
  selectScheduledMinuteEvidence,
  topicsContainedInEvidence,
} from "../../site/scripts/build-search-index.mjs";

test("evidence minute_idは同じschedule_idの原文だけを返す", () => {
  const evidence = buildMinuteEvidenceBySchedule({
    schedules: [
      {
        schedule_id: 13,
        minutes: [{ minute_id: 91, text: "別日程の無関係な発言" }],
      },
      {
        schedule_id: 15,
        minutes: [
          { minute_id: 91, text: "対象議員の質問" },
          { minute_id: 95, text: "市の答弁" },
        ],
      },
      {
        schedule_id: 16,
        minutes: [{ minute_id: 95, text: "別日程の別件答弁" }],
      },
    ],
  });

  assert.deepEqual(
    selectScheduledMinuteEvidence(evidence, 15, [91, 95]),
    ["対象議員の質問", "市の答弁"]
  );
});

test("schedule_idがない場合はminute_idだけで原文を帰属させない", () => {
  const evidence = buildMinuteEvidenceBySchedule({
    schedules: [
      { schedule_id: 2, minutes: [{ minute_id: 7, text: "委員Aの発言" }] },
      { schedule_id: 3, minutes: [{ minute_id: 7, text: "委員Bの発言" }] },
    ],
  });

  assert.deepEqual(selectScheduledMinuteEvidence(evidence, null, [7]), []);
});

test("restricted自治体は議事録由来検索本文を公開対象にしない", () => {
  assert.equal(minutesSearchIsRestricted({ minutes_access: "restricted" }), true);
  assert.equal(minutesSearchIsRestricted({ minutes_access: "public" }), false);
  assert.equal(minutesSearchIsRestricted({}), false);
});

test("member activityの公開テーマは公式evidenceに完全包含されるものだけ", () => {
  const evidence = "ラピダス進出に伴う固定資産税と学校給食について質問します。";
  assert.deepEqual(
    topicsContainedInEvidence(
      ["固定資産税", "学校給食", "AIが生成した未確認テーマ"],
      evidence
    ),
    ["固定資産税", "学校給食"]
  );
});

test("session検索payloadはAI要約・AI topicを捨て公式transcriptだけを保持する", () => {
  const segment = evidenceOnlySessionSegment({
    index: 4,
    label: "一般質問",
    speaker: "山田議員",
    start_time: "10:15",
    summary: "AI要約だけにある未確認語",
    topics: ["AI生成トピック"],
    transcript: "公式transcriptにある道路整備",
  });
  assert.deepEqual(segment, {
    index: 4,
    label: "一般質問",
    speaker: "山田議員",
    start_time: "10:15",
    transcript: "公式transcriptにある道路整備",
  });
  assert.equal(Object.hasOwn(segment, "summary"), false);
  assert.equal(Object.hasOwn(segment, "topics"), false);
});

test("Range表示本文は原文の句読点・表記を保ち照合時だけ正規化できる", () => {
  const source = "  ラピダス・髙橋議員は、道路整備を質問した。\n次の答弁です。  ";
  const value = exactTextAssetValue({
    _exactEvidenceText: source,
  });
  assert.equal(value, "ラピダス・髙橋議員は、道路整備を質問した。 次の答弁です。");
  assert.match(value, /ラピダス・髙橋/u);
  assert.match(value, /、|。/u);
  assert.equal(compactForSearch(value), compactForSearch(source));
});

test("agenda全文も原文の連続句読点をRange表示まで保持する", () => {
  const council = JSON.parse(fs.readFileSync(
    new URL("../../site/data/hakodate/minutes/1239.json", import.meta.url),
    "utf8"
  ));
  const schedule = council.schedules.find((row) => Number(row.schedule_id) === 6);
  const minute = schedule.minutes.find((row) => String(row.text).includes("ラブライブ"));
  const evidence = normalizeMinuteBodyForSearchEvidence(minute.title, minute.text);

  assert.match(evidence, /ラブライブ！サンシャイン！！/u);
  assert.doesNotMatch(evidence, /^◆?\s*（荒木明美議員）\s*◆?\s*（荒木明美議員）/u);
  assert.equal(exactTextAssetValue({ _exactEvidenceText: evidence }), evidence);
});

test("agenda・segmentがないPDF会議録はprovider固有typeの本文を全文fallbackにする", () => {
  const text = buildRawCouncilFallbackText({
    schedules: [
      {
        name: "令和8年第2回定例会",
        minutes: [
          { minute_type: "名簿", text: "出席議員の一覧" },
          { minute_type: "議事手続", text: "会議録署名議員の指名" },
          { minute_type: "本会議", title: "第1号", text: "町道の除雪は民間や地域に委託しています。" },
        ],
      },
    ],
  });

  assert.match(text, /町道の除雪は民間や地域に委託/u);
  assert.doesNotMatch(text, /出席議員の一覧|会議録署名議員の指名/u);
});

test("除外typeに質疑・採決本文が混入したらcoverage preflightで検知できる", () => {
  assert.equal(
    excludedRawMinuteHasSubstantiveText({
      minute_type: "名簿",
      text: "出席議員（32名） 議事日程 第1号議案",
    }),
    false
  );
  assert.equal(
    excludedRawMinuteHasSubstantiveText({
      minute_type: "名簿",
      text: "○議長 これより、採決に入ります。",
    }),
    true
  );
});

test("structured議事録も議長発言・議題を含む公式原文全体を索引する", () => {
  const council = JSON.parse(fs.readFileSync(
    new URL("../../site/data/asahikawa/minutes/327.json", import.meta.url),
    "utf8"
  ));
  const schedule = council.schedules.find((row) => Number(row.schedule_id) === 3);
  const raw = classifyRawScheduleFallback(schedule);
  assert.equal(raw.status, "covered");
  assert.match(raw.text, /これより、採決に入ります/u);
  assert.doesNotMatch(
    raw.text,
    /議長（福居秀雄）\s*[:：]?\s*[○]?議長（福居秀雄）/u
  );
  assert.equal(
    raw.minute_type_ledger.reduce((sum, row) => sum + row.indexed_compact_chars, 0),
    raw.raw_compact_chars
  );
  assert.ok(
    raw.minute_type_ledger.find((row) => row.minute_type === "○議長")
      ?.indexed_compact_chars > 0
  );
  assert.equal(
    raw.minute_type_ledger.find((row) => row.minute_type === "名簿")?.indexed_rows,
    0
  );

  const synthetic = buildRawCouncilFallbackText({
    schedules: [{
      minutes: [
        { minute_type: "△議題", text: "補正予算を議題とします。" },
        { minute_type: "○議長", text: "直ちに採決いたします。" },
      ],
    }],
  });
  assert.match(synthetic, /補正予算を議題/u);
  assert.match(synthetic, /直ちに採決/u);
});

test("CIDだけの行はtitleを本文として数えずtype台帳にも除外理由を残す", () => {
  const raw = classifyRawScheduleFallback({
    name: "第1号",
    minutes: [{
      minute_type: "本会議",
      title: "議長",
      text: Array.from({ length: 20 }, (_, index) => `(cid:${index})`).join(""),
    }],
  });
  const ledger = raw.minute_type_ledger[0];
  assert.equal(raw.reason, "unreadable-cid");
  assert.equal(raw.raw_compact_chars, 0);
  assert.equal(ledger.indexed_compact_chars, 0);
  assert.equal(ledger.excluded_reasons["empty-after-normalization"], 1);
});

test("明示目次と純CIDだけを理由付きで除外する", () => {
  const toc = classifyRawScheduleFallback({
      name: "目次 [PDFファイル]",
      minutes: [{ minute_type: "本会議", text: "一般質問一覧" }],
    });
  assert.equal(toc.reason, "toc-explicit");
  assert.equal(toc.minute_type_ledger[0].indexed_rows, 0);
  assert.equal(toc.minute_type_ledger[0].excluded_reasons["schedule-toc-explicit"], 1);

  const cid = classifyRawScheduleFallback({
      name: "第1号",
      minutes: [{
        minute_type: "本会議",
        text: Array.from({ length: 20 }, (_, index) => `(cid:${index})`).join(""),
      }],
    });
  assert.equal(cid.reason, "unreadable-cid");
  assert.equal(cid.minute_type_ledger[0].indexed_rows, 0);

  const bibai = JSON.parse(fs.readFileSync(
    new URL("../../site/data/bibai/minutes/20251001.json", import.meta.url),
    "utf8"
  ));
  const bibaiToc = classifyRawScheduleFallback(
    bibai.schedules.find((row) => Number(row.schedule_id) === 1)
  );
  assert.equal(bibaiToc.reason, "toc-explicit");
  assert.equal(
    bibaiToc.minute_type_ledger.reduce((sum, row) => sum + row.indexed_rows, 0),
    0
  );

  const abashiri = JSON.parse(fs.readFileSync(
    new URL("../../site/data/abashiri/minutes/20241004.json", import.meta.url),
    "utf8"
  ));
  const abashiriCid = classifyRawScheduleFallback(
    abashiri.schedules.find((row) => Number(row.schedule_id) === 1)
  );
  assert.equal(abashiriCid.reason, "unreadable-cid");
  assert.equal(
    abashiriCid.minute_type_ledger.reduce((sum, row) => sum + row.indexed_rows, 0),
    0
  );
});

test("本文空の公式PDFだけをOCR照合待ちとして明示除外する", () => {
  assert.equal(
    classifyRawScheduleFallback({
      name: "令和6年第5回定例会",
      minutes: [{
        minute_type: "本会議",
        text: "",
        source_url: "https://example.test/minutes/r6.9.10.pdf",
      }],
    }).reason,
    "image-pdf-needs-ocr-review"
  );
  assert.equal(
    classifyRawScheduleFallback({
      name: "令和6年第5回定例会",
      minutes: [{ minute_type: "本会議", text: "", source_url: "https://example.test/minutes" }],
    }).reason,
    "empty-source-text"
  );
});

test("agenda metadataだけではschedule全文coverageを止めない", () => {
  assert.equal(hasSubstantiveAgendaSearchText([{ full_search_text: "" }]), false);
  assert.equal(
    hasSubstantiveAgendaSearchText([{ full_search_text: "町道の除雪について質問します" }]),
    true
  );
});

test("partial agendaより同一scheduleの可読raw全文を優先する", () => {
  const rawFallback = classifyRawScheduleFallback({
    name: "令和7年第4回定例会",
    minutes: [{
      minute_type: "本会議",
      text: "町道の除雪について質問します。町は来年度から地域委託を拡大すると答弁しました。",
    }],
  });
  assert.equal(rawFallback.status, "covered");
  assert.equal(
    selectScheduleExactSource({
      agendaText: "町道の除雪について質問します。",
      rawFallback,
      segmentText: "",
    }).source,
    "raw-minutes"
  );
  assert.equal(
    selectScheduleExactSource({
      agendaText: rawFallback.text,
      rawFallback,
      segmentText: "",
    }).source,
    "agenda"
  );
});

test("同一schedule内の複数agendaはstable unique document idを持つ", () => {
  const base = { city: "chitose", council_id: 490, schedule_index: 0 };
  assert.notEqual(
    agendaSearchDocumentId({ ...base, agenda_index: 0 }),
    agendaSearchDocumentId({ ...base, agenda_index: 1 })
  );
});
