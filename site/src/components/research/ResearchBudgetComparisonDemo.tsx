"use client";

import { useMemo, useState } from "react";
import type {
  BudgetComparisonDemoCity,
  BudgetDemoCategory,
  BudgetDemoEvidence,
  BudgetDemoRow,
} from "@/types/budgetComparisonDemo";

const CATEGORY_OPTIONS: Array<{
  value: BudgetDemoCategory;
  label: string;
  description: string;
}> = [
  { value: "expense", label: "歳出（使い道）", description: "一般会計の目的別歳出" },
  { value: "revenue", label: "歳入（財源）", description: "一般会計の財源別歳入" },
  { value: "special", label: "特別会計", description: "会計ごとの予算総額" },
];

const yenFormatter = new Intl.NumberFormat("ja-JP");

function formatYen(value: number, signed = false): string {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${yenFormatter.format(value)}円`;
}

function formatCompactYen(value: number): string {
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  if (absolute >= 100_000_000) {
    return `${sign}${(absolute / 100_000_000).toLocaleString("ja-JP", {
      maximumFractionDigits: 1,
    })}億円`;
  }
  if (absolute >= 10_000) {
    return `${sign}${(absolute / 10_000).toLocaleString("ja-JP", {
      maximumFractionDigits: 1,
    })}万円`;
  }
  return `${sign}${yenFormatter.format(absolute)}円`;
}

function precisionLabel(precision: number): string {
  if (precision === 1_000_000) return "百万円単位";
  if (precision === 1_000) return "千円単位";
  return "円単位";
}

function sourceUnitValue(value: number, precision: number): string {
  const unit = precision === 1_000_000 ? "百万円" : precision === 1_000 ? "千円" : "円";
  return `原表 ${yenFormatter.format(value / precision)}${unit}`;
}

function amountDescription(value: number, precision: number, signed = false): string {
  if (value === 0 && precision > 1) {
    return `${sourceUnitValue(value, precision)}（下位桁は不明）`;
  }
  return formatYen(value, signed);
}

function comparisonBasisLabel(mode: string): string {
  if (mode === "official_restated_previous_to_current") {
    return "R8資料の公式組替前年額と比較";
  }
  return "各年度の原表どうしを比較";
}

function pageLabel(evidence: BudgetDemoEvidence): string {
  if (evidence.format === "html") return "HTML資料";
  if (evidence.physicalPage === null) return "掲載資料";
  const printed =
    evidence.printedPage !== null ? `（紙面 ${evidence.printedPage}ページ）` : "";
  return `PDF ${evidence.physicalPage}ページ${printed}`;
}

function EvidenceLink({ evidence }: { evidence: BudgetDemoEvidence | null }) {
  if (!evidence) return <span className="text-[#718096]">出典位置未記録</span>;
  return (
    <a
      href={evidence.officialLandingUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center font-bold text-[#2A5298] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:ring-offset-2"
      title={evidence.sourceTable}
    >
      {evidence.fiscalYear === 2025 ? "R7" : "R8"} 公式資料・{pageLabel(evidence)}
      <span className="ml-1" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

function RankingColumn({
  title,
  rows,
  direction,
}: {
  title: string;
  rows: BudgetDemoRow[];
  direction: "increase" | "decrease";
}) {
  const maximum = Math.max(...rows.map((row) => Math.abs(row.deltaAmountJpy)), 1);
  return (
    <section className="rounded-xl border border-[#E2E8F0] bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="font-bold text-[#1B3A6B]">{title}</h4>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            direction === "increase"
              ? "bg-[#EEF4FF] text-[#1B3A6B]"
              : "bg-[#FFF7E6] text-[#78451F]"
          }`}
        >
          増減額順
        </span>
      </div>
      {rows.length ? (
        <ol className="space-y-4">
          {rows.map((row, index) => {
            const width = Math.max(8, (Math.abs(row.deltaAmountJpy) / maximum) * 100);
            return (
              <li key={row.comparisonId}>
                <div className="mb-1 flex items-start justify-between gap-3 text-sm">
                  <span className="font-bold text-[#1A202C]">
                    {index + 1}. {row.label}
                  </span>
                  <span className="shrink-0 font-black tabular-nums text-[#1B3A6B]">
                    {formatCompactYen(row.deltaAmountJpy)}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[#EDF2F7]" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${
                      direction === "increase" ? "bg-[#2A5298]" : "bg-[#F7C948]"
                    }`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-[#718096]">
                  {row.accountLabel} / {precisionLabel(row.sourcePrecisionJpy)}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm leading-relaxed text-[#4A5568]">
          この限定範囲では該当する項目を特定できませんでした。0円や資料不存在を意味しません。
        </p>
      )}
    </section>
  );
}

function ComparisonTable({ rows }: { rows: BudgetDemoRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white">
      <table className="min-w-[860px] w-full border-collapse text-left text-sm">
        <caption className="sr-only">R7・R8予算額と増減額、公式資料への出典</caption>
        <thead className="bg-[#F8FAFC] text-[#1B3A6B]">
          <tr>
            <th scope="col" className="px-4 py-3 font-bold">項目</th>
            <th scope="col" className="px-4 py-3 font-bold">R7</th>
            <th scope="col" className="px-4 py-3 font-bold">R8</th>
            <th scope="col" className="px-4 py-3 font-bold">増減額</th>
            <th scope="col" className="px-4 py-3 font-bold">公式資料</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E2E8F0]">
          {rows.map((row) => (
            <tr key={row.comparisonId} className="align-top">
              <th scope="row" className="px-4 py-4 font-bold text-[#1A202C]">
                {row.label}
                <span className="mt-1 block text-xs font-normal text-[#718096]">
                  {row.accountLabel}
                </span>
              </th>
              <td className="px-4 py-4 tabular-nums text-[#1A202C]">
                {amountDescription(row.baselineAmountJpy, row.sourcePrecisionJpy)}
                <span className="mt-1 block text-xs text-[#718096]">
                  {sourceUnitValue(row.baselineAmountJpy, row.sourcePrecisionJpy)}
                </span>
              </td>
              <td className="px-4 py-4 tabular-nums text-[#1A202C]">
                {amountDescription(row.currentAmountJpy, row.sourcePrecisionJpy)}
                <span className="mt-1 block text-xs text-[#718096]">
                  {sourceUnitValue(row.currentAmountJpy, row.sourcePrecisionJpy)}
                </span>
              </td>
              <td className="px-4 py-4 font-black tabular-nums text-[#1B3A6B]">
                {amountDescription(row.deltaAmountJpy, row.sourcePrecisionJpy, true)}
                <span className="mt-1 block text-xs font-normal text-[#718096]">
                  {precisionLabel(row.sourcePrecisionJpy)} / 比較確認待ち
                </span>
                {row.restatementAdjustmentJpy !== null ? (
                  <span className="mt-1 block text-xs font-normal text-[#78451F]">
                    組替調整 {formatYen(row.restatementAdjustmentJpy, true)}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-xs">
                <div className="flex flex-col items-start">
                  <EvidenceLink evidence={row.baselineEvidence} />
                  <EvidenceLink evidence={row.currentEvidence} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResearchBudgetComparisonDemo({
  cities,
}: {
  cities: BudgetComparisonDemoCity[];
}) {
  const [municipalityId, setMunicipalityId] = useState(cities[0]?.municipalityId ?? "");
  const [category, setCategory] = useState<BudgetDemoCategory>("expense");
  const city = cities.find((item) => item.municipalityId === municipalityId) ?? cities[0];
  const ranking = city?.rankings[category];
  const tableRows = useMemo(
    () => (ranking ? [...ranking.increases, ...ranking.decreases] : []),
    [ranking],
  );

  if (!city || !ranking) return null;

  const categoryOption = CATEGORY_OPTIONS.find((item) => item.value === category);
  const maximumIncrease = ranking.increases[0];
  const maximumDecrease = ranking.decreases[0];
  const officialRestated = ranking.comparisonMode === "official_restated_previous_to_current";

  return (
    <section className="theme-panel mb-8 overflow-hidden" aria-labelledby="budget-demo-title">
      <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="rounded-full bg-[#E6FFFA] px-3 py-1 text-[#276749]">技術検証済み</span>
          <span className="rounded-full bg-[#FFF7E6] px-3 py-1 text-[#78451F]">人手の全数確認待ち</span>
          <span className="rounded-full bg-[#EDF2F7] px-3 py-1 text-[#4A5568]">パスワード付き実証</span>
        </div>
        <h2 id="budget-demo-title" className="mt-3 text-2xl font-black text-[#1B3A6B] sm:text-3xl">
          R7→R8 予算変化ダッシュボード
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-[#1A202C]">
          予算書を1枚ずつ開かなくても、市内で増えた予算・減った予算を並べ替え、金額から公式資料の該当ページへ戻れます。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
          5市を切り替えて確認する画面です。自治体間で同じ項目を比較する機能ではありません。
        </p>
      </div>

      <div className="space-y-7 px-5 py-6 sm:px-7">
        <div>
          <p className="mb-2 text-sm font-bold text-[#1B3A6B]">自治体を選ぶ</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="自治体を選ぶ">
            {cities.map((item) => (
              <button
                key={item.municipalityId}
                type="button"
                onClick={() => setMunicipalityId(item.municipalityId)}
                aria-pressed={item.municipalityId === city.municipalityId}
                className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:ring-offset-2 ${
                  item.municipalityId === city.municipalityId
                    ? "border-[#1B3A6B] bg-[#1B3A6B] text-white"
                    : "border-[#CBD5E0] bg-white text-[#1B3A6B] hover:bg-[#EEF4FF]"
                }`}
              >
                {item.municipalityName}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-[#1B3A6B]">見る範囲を選ぶ</p>
          <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="予算区分を選ぶ">
            {CATEGORY_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                aria-pressed={item.value === category}
                className={`min-h-14 rounded-lg border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:ring-offset-2 ${
                  item.value === category
                    ? "border-[#2A5298] bg-[#EEF4FF] text-[#1B3A6B]"
                    : "border-[#E2E8F0] bg-white text-[#4A5568] hover:border-[#A0AEC0]"
                }`}
              >
                <span className="block font-bold">{item.label}</span>
                <span className="mt-1 block text-xs">{item.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[#EEF4FF] px-4 py-4">
            <p className="text-sm font-bold text-[#4A5568]">比較できた項目</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-[#1B3A6B]">
              {ranking.comparableCount}項目
            </p>
          </div>
          <div className="rounded-xl bg-[#EEF4FF] px-4 py-4">
            <p className="text-sm font-bold text-[#4A5568]">最大の増加額</p>
            <p className="mt-1 text-xl font-black text-[#1B3A6B]">
              {maximumIncrease ? formatCompactYen(maximumIncrease.deltaAmountJpy) : "該当なし"}
            </p>
            {maximumIncrease ? <p className="mt-1 text-xs text-[#4A5568]">{maximumIncrease.label}</p> : null}
          </div>
          <div className="rounded-xl bg-[#FFF7E6] px-4 py-4">
            <p className="text-sm font-bold text-[#4A5568]">最大の減少額</p>
            <p className="mt-1 text-xl font-black text-[#78451F]">
              {maximumDecrease ? formatCompactYen(maximumDecrease.deltaAmountJpy) : "該当なし"}
            </p>
            {maximumDecrease ? <p className="mt-1 text-xs text-[#4A5568]">{maximumDecrease.label}</p> : null}
          </div>
        </div>

        <div className="rounded-lg border-l-4 border-[#F7C948] bg-[#FFFDF5] px-4 py-3 text-sm leading-relaxed text-[#4A5568]">
          <p className="font-bold text-[#1A202C]">比較条件: {comparisonBasisLabel(ranking.comparisonMode)}</p>
          <p className="mt-1">
            {officialRestated
              ? "組織変更の影響を分離するため、札幌市R8資料の公式な組替前年額を使います。各年度原表の別比較12件はランキングに混ぜていません。"
              : "R7とR8それぞれの原表に記載された当年度額を比べています。増減率は未算出のため表示していません。"}
          </p>
          {city.excludedAlternativeComparisonCount > 0 ? (
            <p className="mt-1">
              {city.municipalityId === "sapporo"
                ? `札幌市の公式組替前年額による比較 ${city.excludedAlternativeComparisonCount}件は、丸め差と出典位置の確認が完了するまで分離しています。`
                : `比較条件が異なる ${city.excludedAlternativeComparisonCount}件は、この表示から分離しています。`}
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-xl font-black text-[#1B3A6B]">
                {city.municipalityName}・{categoryOption?.label}の増減ランキング
              </h3>
              <p className="mt-1 text-sm text-[#4A5568]">増加と減少を分け、金額差の大きい順に表示します。</p>
            </div>
            {ranking.unchangedCount > 0 ? (
              <p className="text-sm font-bold text-[#4A5568]">原表単位で変化なし: {ranking.unchangedCount}項目</p>
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RankingColumn title="増加額 上位" rows={ranking.increases} direction="increase" />
            <RankingColumn title="減少額 上位" rows={ranking.decreases} direction="decrease" />
          </div>
        </div>

        <section aria-labelledby="budget-comparison-table-title">
          <h3 id="budget-comparison-table-title" className="mb-2 text-xl font-black text-[#1B3A6B]">
            R7・R8 比較表と出典
          </h3>
          <p className="mb-3 text-sm leading-relaxed text-[#4A5568]">
            金額は円換算値と原表単位を併記します。リンク先は自治体公式の掲載ページです。
          </p>
          <ComparisonTable rows={tableRows} />
        </section>

        <section className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-5" aria-labelledby="coverage-title">
          <h3 id="coverage-title" className="text-xl font-black text-[#1B3A6B]">データ充足状況</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
            「まだ取得していない」「別資料にある」「存在確認中」を、0円や資料不存在として扱いません。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white px-4 py-3">
              <p className="text-sm text-[#4A5568]">技術処理済み</p>
              <p className="mt-1 text-xl font-black tabular-nums text-[#1B3A6B]">
                {city.coverage.normalizedScopes}/{city.coverage.totalScopes}範囲
              </p>
            </div>
            <div className="rounded-lg bg-white px-4 py-3">
              <p className="text-sm text-[#4A5568]">別資料・後続処理</p>
              <p className="mt-1 text-xl font-black tabular-nums text-[#1B3A6B]">
                {city.coverage.deferredOrSeparateScopes}範囲
              </p>
            </div>
            <div className="rounded-lg bg-white px-4 py-3">
              <p className="text-sm text-[#4A5568]">更新確認が必要</p>
              <p className="mt-1 text-xl font-black tabular-nums text-[#1B3A6B]">
                {city.coverage.freshnessAttentionScopes}範囲
              </p>
            </div>
            <div className="rounded-lg bg-white px-4 py-3">
              <p className="text-sm text-[#4A5568]">人手確認待ち</p>
              <p className="mt-1 text-xl font-black tabular-nums text-[#78451F]">
                {city.approvedReviewItems}/{city.reviewItems}件承認
              </p>
            </div>
          </div>
          {(city.coverage.unknownExistenceScopes > 0 || city.coverage.followUpScopes > 0) ? (
            <p className="mt-3 text-sm text-[#4A5568]">
              追加確認対象 {city.coverage.followUpScopes}範囲
              {city.coverage.unknownExistenceScopes > 0
                ? `（うち資料の存在確認中 ${city.coverage.unknownExistenceScopes}範囲）`
                : ""}
            </p>
          ) : null}
        </section>

        <div className="theme-alert px-4 py-4 text-sm leading-relaxed text-[#78451F]" role="note">
          <p className="font-bold">限定テスト上の注意</p>
          <p className="mt-1">
            数値・参照関係は技術検証済みですが、人による全数承認前です。予算案・可決後資料・状態未確認が市ごとに異なるため、成立予算とは一律に断定していません。
          </p>
        </div>
      </div>
    </section>
  );
}
