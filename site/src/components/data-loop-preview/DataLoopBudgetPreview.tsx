"use client";

import { useMemo, useState } from "react";
import type {
  DataLoopPreview,
  DataLoopPreviewMunicipality,
  PreviewComparison,
  PreviewCoverage,
} from "@/lib/dataLoopPreview";

const money = new Intl.NumberFormat("ja-JP");
const percent = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

const blockerLabels: Record<string, string> = {
  HUMAN_REVIEW_PENDING: "人手確認待ち",
  SOURCE_REVISION_UNVERIFIED: "原本revision未確認",
  LEGISLATIVE_STATUS_UNVERIFIED: "予算案・可決状態未確認",
  OFFICIAL_CURRENT_CONFIRMATION_UNAVAILABLE: "公式ページの現行確認待ち",
  DIRECT_FILE_URL_UNKNOWN: "PDF直接URL未記録",
  PROPOSAL_TO_ENACTED_MATCH_UNVERIFIED: "予算案と可決後資料の一致未確認",
  SOURCE_CELL_SEMANTICS_REVIEW_PENDING: "原表セル表現の確認待ち",
  SOURCE_VALUE_ANOMALY_REVIEW_REQUIRED: "大きな数値変化の確認待ち",
  RESTATEMENT_REVIEW_PENDING: "組替比較の確認待ち",
  REUSE_FACT_PUBLICATION_PENDING: "加工数値の利用条件確認待ち",
  REUSE_RAG_PUBLICATION_PENDING: "RAG利用条件確認待ち",
  RAW_REDISTRIBUTION_PERMISSION_PENDING: "原本画像再配布の確認待ち",
  LINK_POLICY_UNRESOLVED: "リンク条件未確認",
  FRESHNESS_NOT_CURRENT: "更新確認期限切れ・未設定",
  COVERAGE_COLLECTION_VERSION_MISSING: "Coverage集合version未付与",
  CONCEPT_REGISTRY_UNMAPPED: "共通分類未確定",
  CROSS_CITY_COMPARISON_BLOCKED: "自治体間比較停止中",
  RAW_PUBLIC_ASSET_GATE_CONFLICT: "既存画像公開と新gateが未整合",
};

const coverageStateLabels: Record<string, string> = {
  exists: "資料あり",
  unknown: "未確認",
  not_published_confirmed: "未公表確認済み",
  does_not_exist_confirmed: "不存在確認済み",
  in_scope: "今回処理済み",
  deferred: "後続対応",
  separate_source: "別資料",
  separate_model: "別モデル",
  out_of_scope: "対象外",
  unknown_not_assessed: "未評価",
  passed: "合格",
  blocked: "停止中",
  pending: "確認待ち",
  not_required: "数値確認対象外",
  current: "確認期限内",
  check_due: "更新確認が必要",
  unknown_freshness: "更新状態未確認",
  found: "発見済み",
  succeeded: "完了",
  partial: "一部完了",
  not_started: "未着手",
  complete_for_declared_scope: "宣言範囲は充足",
};

const comparisonModeLabels: Record<string, string> = {
  own_year_original_to_own_year_original: "各年度の原表値",
  official_restated_previous_to_current: "公式組替後前年比",
  source_reported_previous_to_current: "原表記載の前年比",
};

const eventLabels: Record<string, string> = {
  account_abolished: "会計廃止",
  account_created: "会計新設",
  classification_abolished: "科目廃止",
  classification_restatement: "科目組替",
  present: "あり",
  absent: "なし",
  structural_zero: "構造上の0",
  ordinary_numeric_value: "通常の金額",
  not_applicable: "金額対象外",
};

function signedMoney(value: number) {
  if (value === 0) return "0円";
  return `${value > 0 ? "+" : "−"}${money.format(Math.abs(value))}円`;
}

function deltaPercent(item: PreviewComparison) {
  if (item.baseline_amount_jpy === 0) return null;
  return (item.delta_amount_jpy / item.baseline_amount_jpy) * 100;
}

function scopeLabel(item: PreviewCoverage) {
  const values = Object.values(item.scope).filter((value) => typeof value === "string");
  return values.join(" / ") || "範囲未記録";
}

function sourceLabel(evidence: PreviewComparison["evidence"][number]) {
  const page = evidence.physical_page ? `PDF ${evidence.physical_page}ページ` : evidence.format.toUpperCase();
  const printed = evidence.printed_page == null ? "" : `・紙面 ${evidence.printed_page}`;
  return `${page}${printed}`;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-[#4A5568]">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-[#1B3A6B]">{value}</p>
      <p className="mt-1 text-sm leading-relaxed text-[#718096]">{note}</p>
    </div>
  );
}

function CitySummary({ city }: { city: DataLoopPreviewMunicipality }) {
  const privateReady = city.release_surfaces.private_data === "ready";
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={`${city.municipality_name}の処理状況`}>
      <MetricCard label="canonical facts" value={money.format(city.counts.facts)} note="R7・R8の原表値" />
      <MetricCard label="前年比較" value={money.format(city.counts.comparisons)} note="比較basisを分離" />
      <MetricCard label="Coverage" value={money.format(city.counts.coverage_records)} note="未取得・未評価も記録" />
      <MetricCard
        label="現在の状態"
        value={privateReady ? "技術確認済" : "停止中"}
        note={`人手承認 ${city.counts.approved_review_items}/${city.counts.review_items}`}
      />
    </section>
  );
}

function ComparisonTable({ comparisons }: { comparisons: PreviewComparison[] }) {
  if (!comparisons.length) {
    return <div className="rounded-lg border border-[#CBD5E0] bg-white p-8 text-center text-[#718096]">該当する比較はありません。</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[#CBD5E0] bg-white shadow-sm">
      <table className="min-w-[900px] w-full border-collapse text-left">
        <thead className="bg-[#E8EEF7] text-sm text-[#1B3A6B]">
          <tr>
            <th className="px-4 py-3 font-bold">項目</th>
            <th className="px-4 py-3 text-right font-bold">R7</th>
            <th className="px-4 py-3 text-right font-bold">R8</th>
            <th className="px-4 py-3 text-right font-bold">差額</th>
            <th className="px-4 py-3 text-right font-bold">増減率</th>
            <th className="px-4 py-3 font-bold">比較basis・出典</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((item) => {
            const rate = deltaPercent(item);
            return (
              <tr key={item.comparison_id} className="border-t border-[#E2E8F0] align-top">
                <td className="px-4 py-3">
                  <p className="font-bold text-[#1A202C]">{item.label}</p>
                  <p className="mt-1 text-sm text-[#718096]">{item.account_label}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[#1A202C]">{money.format(item.baseline_amount_jpy)}円</td>
                <td className="px-4 py-3 text-right tabular-nums text-[#1A202C]">{money.format(item.current_amount_jpy)}円</td>
                <td className={`px-4 py-3 text-right font-bold tabular-nums ${item.delta_amount_jpy > 0 ? "text-[#065F46]" : item.delta_amount_jpy < 0 ? "text-[#9B2C2C]" : "text-[#4A5568]"}`}>
                  {signedMoney(item.delta_amount_jpy)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[#4A5568]">
                  {rate == null ? "算出不可" : `${rate > 0 ? "+" : ""}${percent.format(rate)}%`}
                </td>
                <td className="px-4 py-3 text-sm text-[#4A5568]">
                  <p>{comparisonModeLabels[item.comparison_mode] ?? item.comparison_mode}</p>
                  {([
                    [`基準（R${item.baseline_fiscal_year - 2018}）`, item.baseline_evidence[0]],
                    [`当年度（R${item.current_fiscal_year - 2018}）`, item.current_evidence[0]],
                  ] as Array<[string, PreviewComparison["evidence"][number] | undefined]>).map(([label, evidence]) => evidence ? (
                    <a
                      key={label}
                      href={evidence.official_landing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block font-bold text-[#2A5298] hover:underline"
                    >
                      {label}: {sourceLabel(evidence)}
                    </a>
                  ) : null)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DataLoopBudgetPreview({ data }: { data: DataLoopPreview }) {
  const [cityId, setCityId] = useState(data.municipalities[0]?.municipality_id ?? "");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const city = data.municipalities.find((item) => item.municipality_id === cityId) ?? data.municipalities[0];
  const comparisons = useMemo(() => {
    if (!city) return [];
    const normalizedQuery = query.replace(/\s+/g, "").toLowerCase();
    return city.comparisons.filter((item) => {
      const matchesMode = mode === "all" || item.comparison_mode === mode;
      const haystack = `${item.label}${item.account_label}`.replace(/\s+/g, "").toLowerCase();
      return matchesMode && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [city, mode, query]);

  if (!city) return null;

  return (
    <div className="space-y-7">
      <nav className="flex flex-wrap gap-2" aria-label="自治体選択">
        {data.municipalities.map((item) => (
          <button
            key={item.municipality_id}
            type="button"
            onClick={() => setCityId(item.municipality_id)}
            className={item.municipality_id === city.municipality_id
              ? "min-h-11 rounded-full bg-[#1B3A6B] px-4 py-2 text-sm font-bold text-white"
              : "min-h-11 rounded-full border border-[#CBD5E0] bg-white px-4 py-2 text-sm font-bold text-[#1B3A6B] hover:border-[#1B3A6B] hover:bg-[#E8EEF7]"}
          >
            {item.municipality_name}
          </button>
        ))}
      </nav>

      <CitySummary city={city} />

      <section className="theme-alert border-l-4 border-[#F7C948] px-5 py-4 text-[#78451F]" aria-labelledby="preview-state-title">
        <h2 id="preview-state-title" className="text-lg font-bold">この画面は限定テスト中です</h2>
        <p className="mt-2 text-sm leading-relaxed">
          数値・参照関係は技術検証済みですが、人による全数承認は未完了です。未評価項目を0や不存在とは扱わず、一般公開・公開RAG・自治体間比較のgateも閉じたままです。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {city.blockers.map((code) => (
            <span key={code} className="rounded-full border border-[#F7C948] bg-white px-3 py-1 text-sm font-bold">
              {blockerLabels[code] ?? code}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="comparison-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="portal-subhead mb-2">YEAR-ON-YEAR</p>
            <h2 id="comparison-title" className="theme-section-title text-xl sm:text-2xl">{city.municipality_name} R7・R8予算比較</h2>
          </div>
          <p className="text-sm text-[#4A5568]">表示 {comparisons.length}/{city.comparisons.length}件</p>
        </div>
        <div className="mb-4 grid gap-3 rounded-lg border border-[#CBD5E0] bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-[#1B3A6B]">
            項目名で絞り込み
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：総務費、市税" className="theme-input mt-2 px-4 py-3 text-base" />
          </label>
          <label className="text-sm font-bold text-[#1B3A6B]">
            比較basis
            <select value={mode} onChange={(event) => setMode(event.target.value)} className="theme-input mt-2 px-4 py-3 text-base">
              <option value="all">すべて</option>
              <option value="own_year_original_to_own_year_original">各年度の原表値</option>
              <option value="official_restated_previous_to_current">公式組替後前年比</option>
              <option value="source_reported_previous_to_current">原表記載の前年比</option>
            </select>
          </label>
        </div>
        <ComparisonTable comparisons={comparisons} />
      </section>

      <section aria-labelledby="coverage-title">
        <div className="mb-4">
          <p className="portal-subhead mb-2">DATA COVERAGE</p>
          <h2 id="coverage-title" className="theme-section-title text-xl sm:text-2xl">取得・解析状況</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">未取得、未評価、別モデル、資料不存在を分けて表示します。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {city.coverage.map((item) => (
            <article key={item.coverage_id} className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-bold text-[#1A202C]">R{item.fiscal_year - 2018}・{scopeLabel(item)}</h3>
                <span className="rounded bg-[#E8EEF7] px-2 py-1 text-sm font-bold text-[#2A5298]">
                  {coverageStateLabels[item.scope_disposition] ?? item.scope_disposition}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="font-bold text-[#718096]">資料状態</dt>
                <dd>{coverageStateLabels[item.existence_state] ?? item.existence_state}</dd>
                <dt className="font-bold text-[#718096]">件数</dt>
                <dd className="tabular-nums">{item.observed_count ?? "未確定"} / {item.expected_count ?? "期待数未確定"}</dd>
                <dt className="font-bold text-[#718096]">処理段階</dt>
                <dd className="flex flex-wrap gap-1">
                  {[
                    ["発見", item.discover_state],
                    ["取得", item.fetch_state],
                    ["解析", item.parse_state],
                    ["正規化", item.normalize_state],
                  ].map(([label, state]) => (
                    <span key={label} className="rounded bg-[#F3F6FA] px-2 py-1 text-xs text-[#4A5568]">
                      {label}: {coverageStateLabels[state] ?? state}
                    </span>
                  ))}
                </dd>
                <dt className="font-bold text-[#718096]">充足度</dt>
                <dd>{coverageStateLabels[item.completeness_assessment] ?? item.completeness_assessment}</dd>
                <dt className="font-bold text-[#718096]">技術検証</dt>
                <dd>{coverageStateLabels[item.technical_validation_state] ?? item.technical_validation_state}</dd>
                <dt className="font-bold text-[#718096]">人手確認</dt>
                <dd>{coverageStateLabels[item.human_review_status] ?? item.human_review_status}</dd>
                <dt className="font-bold text-[#718096]">更新状態</dt>
                <dd>
                  {coverageStateLabels[item.freshness_status] ?? item.freshness_status}
                  {item.next_check_at ? `（次回 ${item.next_check_at.slice(0, 10)}）` : "（次回日未設定）"}
                </dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {city.structural_events.length ? (
        <section aria-labelledby="event-title">
          <h2 id="event-title" className="theme-section-title text-xl sm:text-2xl">構造変更</h2>
          <div className="mt-4 grid gap-3">
            {city.structural_events.map((event) => (
              <article key={event.event_id} className="rounded-lg border border-[#F7C948] bg-[#FFF7E6] p-4">
                <p className="text-sm font-bold text-[#78451F]">R{event.fiscal_year - 2018}・{eventLabels[event.event_type] ?? event.event_type}</p>
                <h3 className="mt-1 text-lg font-bold text-[#1A202C]">{event.label}</h3>
                <p className="mt-2 text-sm text-[#4A5568]">
                  {eventLabels[event.presence_before] ?? event.presence_before} → {eventLabels[event.presence_after] ?? event.presence_after}
                  {" / "}{eventLabels[event.reported_amount_semantics] ?? event.reported_amount_semantics}
                </p>
                {event.evidence[0] ? <a href={event.evidence[0].official_landing_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-bold text-[#2A5298] hover:underline">公式資料を確認</a> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
