import type { BudgetAmount, BudgetNumericFinding } from "@/types/research";

function formatYen(value: number): string {
  return `${new Intl.NumberFormat("ja-JP").format(value)}円`;
}

function fiscalYearLabel(value: number): string {
  if (value === 2025) return "R7（2025年度）";
  if (value === 2026) return "R8（2026年度）";
  return `${value}年度`;
}

function legislativeLabel(value: string): string {
  if (value === "enacted") return "可決後資料";
  if (value === "proposed") return "予算案";
  return "可決状態未確認";
}

function comparisonModeLabel(value: string): string {
  if (value === "own_year_original_to_own_year_original") return "各年度原表どうし";
  if (value === "official_restated_previous_to_current") return "R8資料の公式組替前年との比較";
  return value;
}

function sourceUnitLabel(amount: BudgetAmount): string {
  if (amount.sourceUnit === "million_yen") return "百万円単位";
  if (amount.sourceUnit === "thousand_yen") return "千円単位";
  return "円単位";
}

function AmountCell({ amount }: { amount: BudgetAmount }) {
  return (
    <div>
      <p className="font-bold tabular-nums text-[#1A202C]">{formatYen(amount.amountJpy)}</p>
      <p className="mt-1 text-xs text-[#718096]">
        原表 {new Intl.NumberFormat("ja-JP").format(amount.sourceReportedValue)}（{sourceUnitLabel(amount)}）
      </p>
      <p className="mt-1 text-xs text-[#718096]">{legislativeLabel(amount.legislativeStatus)}</p>
    </div>
  );
}

function EventDescription({ finding }: { finding: BudgetNumericFinding }) {
  const event = finding.structuralEvent;
  if (!event) return null;
  const eventLabels: Record<string, string> = {
    account_created: "会計の新設",
    structural_zero: "構造上の廃止・皆減",
    classification_restatement: "分類の組替",
  };
  return (
    <div className="mt-4 rounded-lg bg-[#F8FAFC] px-4 py-3 text-sm text-[#1A202C]">
      <p className="font-bold">
        {fiscalYearLabel(event.effectiveFiscalYear)}: {eventLabels[event.eventType] ?? event.eventType}
      </p>
      <p className="mt-1 text-[#4A5568]">
        状態: {event.presenceBefore} → {event.presenceAfter}
      </p>
      {event.sourceReportedCurrentAmount !== null ? (
        <p className="mt-1 tabular-nums">原表の当年度額: {formatYen(event.sourceReportedCurrentAmount)}</p>
      ) : null}
    </div>
  );
}

function EvidenceList({ finding }: { finding: BudgetNumericFinding }) {
  return (
    <div className="mt-5 border-t border-[#E2E8F0] pt-4">
      <h4 className="text-sm font-bold text-[#1B3A6B]">出典</h4>
      <ul className="mt-2 space-y-2 text-sm text-[#4A5568]">
        {finding.evidences.map((evidence) => {
          const page = evidence.physicalPage
            ? `PDF ${evidence.physicalPage}ページ${evidence.printedPage ? `（紙面 ${evidence.printedPage}ページ）` : ""}`
            : "HTML資料";
          return (
            <li key={evidence.evidenceId} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-3">
              <p>
                {evidence.fiscalYear ? fiscalYearLabel(evidence.fiscalYear) : "関連年度"} / {page}
              </p>
              <p className="mt-1 text-xs text-[#718096]">{evidence.sourceTable}</p>
              <a
                href={evidence.officialLandingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex font-bold text-[#2A5298] hover:underline"
              >
                自治体公式の掲載ページを見る
                <span aria-hidden="true">↗</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ResearchBudgetFindings({
  findings,
  limitations,
}: {
  findings: BudgetNumericFinding[];
  limitations: string[];
}) {
  return (
    <div className="space-y-6">
      <div className="theme-alert px-5 py-4 text-[#78451F]" role="status">
        <p className="font-bold">予算データ限定テスト</p>
        <p className="mt-1 text-sm leading-relaxed">
          金額は構造化データから決定的に表示しています。AIは金額を生成していません。技術検証済みですが、人の全数承認前です。
        </p>
      </div>

      {findings.length ? (
        <section className="theme-panel px-5 py-5 sm:px-6" aria-labelledby="budget-findings-title">
          <h2 id="budget-findings-title" className="theme-section-title mb-4 text-xl sm:text-2xl">
            予算の検索結果
          </h2>
          <div className="space-y-4">
            {findings.map((finding) => (
              <article key={finding.id} className="theme-card-soft px-4 py-5 sm:px-5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="theme-pill-soft">{finding.municipalityName}</span>
                  <span className="rounded-full bg-[#E6FFFA] px-3 py-1 text-[#276749]">技術検証済み</span>
                  <span className="rounded-full bg-[#FFF7E6] px-3 py-1 text-[#78451F]">人手確認待ち</span>
                  <span className="rounded-full bg-[#EDF2F7] px-3 py-1 text-[#4A5568]">
                    {finding.retrieval.mode === "structured_and_private_chunk"
                      ? "構造化値＋private chunk照合"
                      : "構造化値"}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold text-[#1B3A6B]">{finding.label}</h3>
                {finding.accountLabel ? (
                  <p className="mt-1 text-sm text-[#4A5568]">{finding.accountLabel}</p>
                ) : null}

                {finding.fact ? (
                  <div className="mt-4 rounded-lg bg-white px-4 py-3">
                    <p className="mb-1 text-xs font-bold text-[#4A5568]">
                      {fiscalYearLabel(finding.fact.fiscalYear)}
                    </p>
                    <AmountCell amount={finding.fact} />
                  </div>
                ) : null}

                {finding.comparison ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-white px-4 py-3">
                        <p className="mb-1 text-xs font-bold text-[#4A5568]">
                          {fiscalYearLabel(finding.comparison.baseline.fiscalYear)}
                        </p>
                        <AmountCell amount={finding.comparison.baseline} />
                      </div>
                      <div className="rounded-lg bg-white px-4 py-3">
                        <p className="mb-1 text-xs font-bold text-[#4A5568]">
                          {fiscalYearLabel(finding.comparison.current.fiscalYear)}
                        </p>
                        <AmountCell amount={finding.comparison.current} />
                      </div>
                      <div className="rounded-lg bg-[#EEF4FF] px-4 py-3">
                        <p className="mb-1 text-xs font-bold text-[#4A5568]">増減</p>
                        <p className="font-bold tabular-nums text-[#1B3A6B]">
                          {finding.comparison.deltaAmountJpy > 0 ? "+" : ""}
                          {formatYen(finding.comparison.deltaAmountJpy)}
                        </p>
                        <p className="mt-1 text-xs text-[#4A5568]">
                          原表の精度: {sourceUnitLabel(finding.comparison.current)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-[#4A5568]">
                      比較基準: {comparisonModeLabel(finding.comparison.comparisonMode)} / 比較確認待ち
                    </p>
                  </>
                ) : null}

                <EventDescription finding={finding} />
                <EvidenceList finding={finding} />
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="theme-panel px-5 py-5 sm:px-6">
          <h2 className="theme-section-title mb-3 text-xl sm:text-2xl">予算の検索結果</h2>
          <p className="text-sm leading-relaxed text-[#4A5568]">
            現在の限定テスト範囲では一致する構造化行を特定できませんでした。0円や資料不存在を意味する結果ではありません。
          </p>
        </section>
      )}

      <section className="theme-panel px-5 py-5 sm:px-6">
        <h2 className="theme-section-title mb-4 text-xl sm:text-2xl">この結果の限界</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#4A5568]">
          {limitations.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
