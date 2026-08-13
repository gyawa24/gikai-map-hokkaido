"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  RESEARCH_QUERY_MAX_LENGTH,
  type Evidence,
  type ResearchMode,
  type ResearchMunicipalityOption,
  type ResearchResponse,
} from "@/types/research";

type Props = {
  municipalities: ResearchMunicipalityOption[];
};

const MODE_OPTIONS: Array<{ value: ResearchMode; label: string; description: string }> = [
  {
    value: "research",
    label: "調査",
    description: "議論の概要、論点、行政答弁を横断して整理します。",
  },
  {
    value: "comparison",
    label: "自治体比較",
    description: "指定した自治体の共通点と違いを整理します。",
  },
  {
    value: "question_prep",
    label: "一般質問準備",
    description: "質問を組み立てるための論点と追加確認事項を整理します。",
  },
];

const SOURCE_TYPE_LABELS: Record<Evidence["sourceType"], string> = {
  plenary_minutes: "本会議議事録",
  committee_minutes: "委員会議事録",
  administrative_plan: "行政計画",
  budget: "予算",
  settlement: "決算",
  project_evaluation: "事業評価",
  ordinance: "条例",
  organization: "組織情報",
  statistics: "統計",
  open_data: "オープンデータ",
  other: "その他",
};

const EVIDENCE_LEVEL_LABELS: Record<Evidence["evidenceLevel"], string> = {
  full_text_verified: "原文確認済み",
  excerpt_verified: "抜粋確認済み",
  metadata_only: "書誌情報のみ",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEvidence(value: unknown): value is Evidence {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.municipalityId === "string" &&
    typeof value.municipalityName === "string" &&
    typeof value.sourceType === "string" &&
    value.sourceType in SOURCE_TYPE_LABELS &&
    typeof value.title === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.sourceUrl === "string" &&
    typeof value.evidenceLevel === "string" &&
    value.evidenceLevel in EVIDENCE_LEVEL_LABELS
  );
}

function isResearchResponse(value: unknown): value is ResearchResponse {
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.metadata)) return false;
  const { result, metadata } = value;
  if (!isRecord(metadata.ai)) return false;
  return (
    typeof value.requestId === "string" &&
    typeof value.disclaimer === "string" &&
    typeof result.query === "string" &&
    typeof result.summary === "string" &&
    Array.isArray(result.keyIssues) &&
    result.keyIssues.every(
      (item) =>
        isRecord(item) &&
        hasStringArray(item.evidenceIds) &&
        typeof item.title === "string" &&
        typeof item.description === "string"
    ) &&
    Array.isArray(result.municipalityComparisons) &&
    result.municipalityComparisons.every(
      (item) =>
        isRecord(item) &&
        hasStringArray(item.evidenceIds) &&
        typeof item.municipalityId === "string" &&
        typeof item.municipalityName === "string" &&
        typeof item.summary === "string" &&
        hasStringArray(item.points)
    ) &&
    Array.isArray(result.administrationResponsePatterns) &&
    result.administrationResponsePatterns.every(
      (item) =>
        isRecord(item) &&
        hasStringArray(item.evidenceIds) &&
        typeof item.pattern === "string" &&
        typeof item.description === "string"
    ) &&
    Array.isArray(result.policyOptions) &&
    result.policyOptions.every(
      (item) =>
        isRecord(item) &&
        hasStringArray(item.evidenceIds) &&
        typeof item.title === "string" &&
        typeof item.description === "string"
    ) &&
    hasStringArray(result.nextResearchItems) &&
    Array.isArray(result.evidences) &&
    result.evidences.every(isEvidence) &&
    hasStringArray(result.limitations) &&
    (metadata.ai.status === "completed" ||
      metadata.ai.status === "fallback" ||
      metadata.ai.status === "disabled") &&
    typeof metadata.evidenceCount === "number" &&
    typeof metadata.searchResultCount === "number" &&
    typeof metadata.durationMs === "number"
  );
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function EmptyMessage() {
  return <p className="text-sm text-[#718096]">該当する整理結果はありません。</p>;
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="theme-section-title mb-4 text-xl sm:text-2xl">{children}</h2>;
}

function EvidenceReferences({
  evidenceIds,
  evidenceNumberById,
}: {
  evidenceIds: string[];
  evidenceNumberById: Map<string, number>;
}) {
  const references = [...new Set(evidenceIds)]
    .map((id) => evidenceNumberById.get(id))
    .filter((number): number is number => number !== undefined);
  if (!references.length) return null;

  return (
    <p className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-[#2A5298]">
      {references.map((number) => (
        <a
          key={number}
          href={`#research-evidence-${number}`}
          className="rounded-full border border-[#C7D2E5] bg-white px-3 py-1 hover:underline"
        >
          根拠 {number}
        </a>
      ))}
    </p>
  );
}

function ResultSections({ response }: { response: ResearchResponse }) {
  const { result, metadata } = response;
  const evidenceNumberById = useMemo(
    () => new Map(result.evidences.map((evidence, index) => [evidence.id, index + 1])),
    [result.evidences]
  );

  return (
    <div className="mt-8 space-y-6">
      {metadata.ai.status !== "completed" ? (
        <div className="theme-alert px-5 py-4 text-[#78451F]" role="status">
          <p className="font-bold">
            AI分析はできませんでしたが、関連する議事録検索結果はこちらです。
          </p>
        </div>
      ) : null}

      <div className="theme-card-soft flex flex-wrap gap-x-5 gap-y-1 px-5 py-3 text-sm text-[#4A5568]">
        <span>検索候補: {metadata.searchResultCount}件</span>
        <span>根拠資料: {metadata.evidenceCount}件</span>
        <span>処理時間: {(metadata.durationMs / 1000).toFixed(1)}秒</span>
      </div>

      <section className="theme-panel px-5 py-5 sm:px-6" aria-labelledby="research-summary">
        <h2 id="research-summary" className="theme-section-title mb-3 text-xl sm:text-2xl">
          調査概要
        </h2>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-[#1A202C]">
          {result.summary}
        </p>
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>主な論点</SectionTitle>
        {result.keyIssues.length ? (
          <div className="space-y-3">
            {result.keyIssues.map((issue, index) => (
              <article key={`${issue.title}-${index}`} className="theme-card-soft px-4 py-4">
                <h3 className="font-bold text-[#1B3A6B]">{issue.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4A5568]">
                  {issue.description}
                </p>
                <EvidenceReferences
                  evidenceIds={issue.evidenceIds}
                  evidenceNumberById={evidenceNumberById}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>自治体別</SectionTitle>
        {result.municipalityComparisons.length ? (
          <div className="space-y-3">
            {result.municipalityComparisons.map((comparison, index) => (
              <article
                key={`${comparison.municipalityId}-${index}`}
                className="theme-card-soft px-4 py-4"
              >
                <h3 className="font-bold text-[#1B3A6B]">{comparison.municipalityName}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4A5568]">
                  {comparison.summary}
                </p>
                {comparison.points.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#1A202C]">
                    {comparison.points.map((point, pointIndex) => (
                      <li key={`${point}-${pointIndex}`}>{point}</li>
                    ))}
                  </ul>
                ) : null}
                <EvidenceReferences
                  evidenceIds={comparison.evidenceIds}
                  evidenceNumberById={evidenceNumberById}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>行政答弁の傾向</SectionTitle>
        {result.administrationResponsePatterns.length ? (
          <div className="space-y-3">
            {result.administrationResponsePatterns.map((item, index) => (
              <article key={`${item.pattern}-${index}`} className="theme-card-soft px-4 py-4">
                <h3 className="font-bold text-[#1B3A6B]">{item.pattern}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4A5568]">
                  {item.description}
                </p>
                <EvidenceReferences
                  evidenceIds={item.evidenceIds}
                  evidenceNumberById={evidenceNumberById}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>政策上の選択肢</SectionTitle>
        {result.policyOptions.length ? (
          <div className="space-y-3">
            {result.policyOptions.map((option, index) => (
              <article key={`${option.title}-${index}`} className="theme-card-soft px-4 py-4">
                <h3 className="font-bold text-[#1B3A6B]">{option.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4A5568]">
                  {option.description}
                </p>
                <EvidenceReferences
                  evidenceIds={option.evidenceIds}
                  evidenceNumberById={evidenceNumberById}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>次に調べるべきこと</SectionTitle>
        {result.nextResearchItems.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#1A202C]">
            {result.nextResearchItems.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>調査上の限界</SectionTitle>
        {result.limitations.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#4A5568]">
            {result.limitations.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <EmptyMessage />
        )}
      </section>

      <section className="theme-panel px-5 py-5 sm:px-6">
        <SectionTitle>根拠資料</SectionTitle>
        {result.evidences.length ? (
          <div className="space-y-4">
            {result.evidences.map((evidence, index) => {
              const number = index + 1;
              const sourceUrl = safeSourceUrl(evidence.sourceUrl);
              const speaker = [evidence.speaker, evidence.speakerRole].filter(Boolean).join(" / ");
              return (
                <article
                  id={`research-evidence-${number}`}
                  key={evidence.id}
                  className="theme-card scroll-mt-24 px-5 py-5"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#4A5568]">
                    <span className="theme-pill-soft">根拠 {number}</span>
                    <span>{SOURCE_TYPE_LABELS[evidence.sourceType]}</span>
                    <span>{EVIDENCE_LEVEL_LABELS[evidence.evidenceLevel]}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-[#1B3A6B]">{evidence.title}</h3>
                  <dl className="mt-3 grid gap-x-5 gap-y-1 text-sm text-[#4A5568] sm:grid-cols-2">
                    <div>
                      <dt className="inline font-bold text-[#1A202C]">自治体: </dt>
                      <dd className="inline">{evidence.municipalityName}</dd>
                    </div>
                    {evidence.meetingName ? (
                      <div>
                        <dt className="inline font-bold text-[#1A202C]">会議名: </dt>
                        <dd className="inline">{evidence.meetingName}</dd>
                      </div>
                    ) : null}
                    {evidence.date ? (
                      <div>
                        <dt className="inline font-bold text-[#1A202C]">日付: </dt>
                        <dd className="inline">{evidence.date}</dd>
                      </div>
                    ) : null}
                    {speaker ? (
                      <div>
                        <dt className="inline font-bold text-[#1A202C]">発言者: </dt>
                        <dd className="inline">{speaker}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <blockquote className="mt-4 whitespace-pre-wrap border-l-4 border-[#9FB1D2] bg-[#F8FAFC] px-4 py-3 text-sm leading-relaxed text-[#1A202C]">
                    {evidence.excerpt}
                  </blockquote>
                  <div className="mt-4">
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="theme-button px-4 py-2 text-sm"
                      >
                        原文を見る
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="text-sm text-[#718096]">原文リンクを確認できません</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyMessage />
        )}
      </section>
    </div>
  );
}

function errorMessage(value: unknown, status: number): string {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }
  if (status === 429) return "調査回数の上限に達しました。少し待ってから再度お試しください。";
  if (status === 504) return "調査に時間がかかっています。少し待ってから再度お試しください。";
  if (status === 503) return "政策AIリサーチャーは現在利用できません。";
  return "調査を開始できませんでした。入力内容を確認してください。";
}

export default function ResearchClient({ municipalities }: Props) {
  const [query, setQuery] = useState("");
  const [selectedMunicipalities, setSelectedMunicipalities] = useState<string[]>([]);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [mode, setMode] = useState<ResearchMode>("research");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ResearchResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const municipalitiesByRegion = useMemo(() => {
    const groups = new Map<string, ResearchMunicipalityOption[]>();
    for (const municipality of municipalities) {
      const values = groups.get(municipality.region) ?? [];
      values.push(municipality);
      groups.set(municipality.region, values);
    }
    return [...groups.entries()];
  }, [municipalities]);

  useEffect(() => {
    if (response) resultRef.current?.focus();
  }, [response]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError("質問を入力してください。");
      return;
    }

    let fiscalYears: number[] | undefined;
    if (yearFrom || yearTo) {
      const from = Number(yearFrom);
      const to = Number(yearTo);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1900 || to > 2200 || from > to) {
        setError("年度は1900〜2200の範囲で、開始年度から終了年度の順に指定してください。");
        return;
      }
      if (to - from + 1 > 50) {
        setError("年度範囲は50年以内で指定してください。");
        return;
      }
      fiscalYears = Array.from({ length: to - from + 1 }, (_, index) => from + index);
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const apiResponse = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: normalizedQuery,
          mode,
          sourceTypes: ["plenary_minutes"],
          ...(selectedMunicipalities.length
            ? { municipalities: selectedMunicipalities }
            : {}),
          ...(fiscalYears ? { fiscalYears } : {}),
        }),
        cache: "no-store",
      });
      const payload = (await apiResponse.json().catch(() => null)) as unknown;
      if (!apiResponse.ok) {
        setError(errorMessage(payload, apiResponse.status));
        return;
      }
      if (!isResearchResponse(payload)) {
        setError("調査結果の形式を確認できませんでした。少し待ってから再度お試しください。");
        return;
      }
      setResponse(payload);
    } catch {
      setError("通信に失敗しました。接続を確認して再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="theme-panel px-5 py-6 sm:px-7" aria-labelledby="research-form-title">
        <h2 id="research-form-title" className="theme-section-title text-xl sm:text-2xl">
          調査条件
        </h2>
        <form className="mt-5 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="research-query" className="block font-bold text-[#1B3A6B]">
              質問 <span className="text-[#C53030]">必須</span>
            </label>
            <textarea
              id="research-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={RESEARCH_QUERY_MAX_LENGTH}
              rows={5}
              required
              className="theme-input mt-2 min-h-36 resize-y px-4 py-3 text-base"
              placeholder="例：学校給食費無償化について、財源、対象範囲、行政答弁を中心に整理してください。"
            />
            <p className="mt-1 text-right text-xs text-[#718096]">
              {query.length} / {RESEARCH_QUERY_MAX_LENGTH}文字
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <label htmlFor="research-municipalities" className="block font-bold text-[#1B3A6B]">
                自治体絞り込み
              </label>
              <p id="research-municipalities-help" className="mt-1 text-sm text-[#4A5568]">
                未選択の場合は横断検索indexに議題がある全{municipalities.length}自治体を対象にします。複数選択できます。
              </p>
              <select
                id="research-municipalities"
                multiple
                size={8}
                value={selectedMunicipalities}
                onChange={(event) =>
                  setSelectedMunicipalities(
                    Array.from(event.currentTarget.selectedOptions, (option) => option.value)
                  )
                }
                aria-describedby="research-municipalities-help"
                className="theme-select mt-2 px-3 py-2 text-base"
              >
                {municipalitiesByRegion.map(([region, values]) => (
                  <optgroup key={region} label={region}>
                    {values.map((municipality) => (
                      <option key={municipality.slug} value={municipality.slug}>
                        {municipality.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[#4A5568]">
                <span>{selectedMunicipalities.length}自治体を選択中</span>
                {selectedMunicipalities.length ? (
                  <button
                    type="button"
                    onClick={() => setSelectedMunicipalities([])}
                    className="font-bold text-[#2A5298] hover:underline"
                  >
                    選択を解除
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-6">
              <fieldset>
                <legend className="font-bold text-[#1B3A6B]">年度絞り込み</legend>
                <p className="mt-1 text-sm text-[#4A5568]">
                  会議日から4月〜翌3月の年度を算出します。両方を空欄にすると全年度を対象にします。
                </p>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div>
                    <label htmlFor="research-year-from" className="block text-sm font-bold">
                      開始年度
                    </label>
                    <input
                      id="research-year-from"
                      type="number"
                      min={1900}
                      max={2200}
                      inputMode="numeric"
                      value={yearFrom}
                      onChange={(event) => setYearFrom(event.target.value)}
                      className="theme-input mt-1 px-3 py-2"
                    />
                  </div>
                  <span className="mt-7 text-[#718096]" aria-hidden="true">
                    〜
                  </span>
                  <div>
                    <label htmlFor="research-year-to" className="block text-sm font-bold">
                      終了年度
                    </label>
                    <input
                      id="research-year-to"
                      type="number"
                      min={1900}
                      max={2200}
                      inputMode="numeric"
                      value={yearTo}
                      onChange={(event) => setYearTo(event.target.value)}
                      className="theme-input mt-1 px-3 py-2"
                    />
                  </div>
                </div>
              </fieldset>

              <div>
                <label htmlFor="research-mode" className="block font-bold text-[#1B3A6B]">
                  モード
                </label>
                <select
                  id="research-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as ResearchMode)}
                  className="theme-select mt-2 px-3 py-2 text-base"
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-[#4A5568]">
                  {MODE_OPTIONS.find((option) => option.value === mode)?.description}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#E2E8F0] pt-5">
            <p className="mb-3 text-sm text-[#4A5568]">
              対象資料: 地方議会ドットコムに収録済みの本会議議事録
            </p>
            <button
              type="submit"
              disabled={loading}
              className="theme-button theme-button-accent min-h-12 w-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {loading ? "調査しています…" : "調査を開始する"}
            </button>
          </div>
        </form>
      </section>

      <div aria-live="polite" aria-atomic="true">
        {loading ? (
          <div className="theme-card-soft mt-6 px-5 py-5 text-[#4A5568]" role="status">
            議事録を検索し、根拠を確認しながら整理しています。しばらくお待ちください。
          </div>
        ) : null}
        {error ? (
          <div className="theme-alert mt-6 px-5 py-4 text-[#78451F]" role="alert">
            <p className="font-bold">調査を完了できませんでした</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        ) : null}
      </div>

      {response ? (
        <div ref={resultRef} tabIndex={-1} className="focus:outline-none" aria-label="調査結果">
          <ResultSections response={response} />
        </div>
      ) : null}
    </>
  );
}
