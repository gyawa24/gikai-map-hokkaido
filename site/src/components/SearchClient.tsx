"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SessionHit, MemberHit } from "@/app/api/search/route";

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>;
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  const regex = new RegExp(`^(?:${pattern})$`, "i");
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 text-[#1A202C] rounded">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

const ALL_CITIES: { id: string; name: string }[] = [
  { id: "chitose",       name: "千歳市" },
  { id: "eniwa",         name: "恵庭市" },
  { id: "tomakomai",     name: "苫小牧市" },
  { id: "asahikawa",     name: "旭川市" },
  { id: "ashibetsu",     name: "芦別市" },
  { id: "date",          name: "伊達市" },
  { id: "hakodate",      name: "函館市" },
  { id: "ishikari",      name: "石狩市" },
  { id: "kitahiroshima", name: "北広島市" },
  { id: "kitami",        name: "北見市" },
  { id: "kushiro",       name: "釧路市" },
  { id: "muroran",       name: "室蘭市" },
  { id: "nayoro",        name: "名寄市" },
  { id: "nemuro",        name: "根室市" },
  { id: "obihiro",       name: "帯広市" },
  { id: "wakkanai",      name: "稚内市" },
];

type SourceFilter = "all" | "minutes" | "session" | "decision";

const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: "すべて",
  minutes: "議事録",
  session: "会議録速報",
  decision: "議決結果",
};

function SearchClientInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [tab, setTab] = useState<"sessions" | "members">("sessions");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [factionFilter, setFactionFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sessionResults, setSessionResults] = useState<SessionHit[]>([]);
  const [memberResults, setMemberResults] = useState<MemberHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCityFilter("all");
    setSourceFilter("all");
    setFactionFilter("all");
    setYearFilter("all");
    const q = query.trim();
    if (!q) {
      setSessionResults([]);
      setMemberResults([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSessionResults(data.sessionResults ?? []);
        setMemberResults(data.memberResults ?? []);
        setTruncated(Boolean(data.truncated));
      } catch {
        setSessionResults([]);
        setMemberResults([]);
        setTruncated(false);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  const tokens = tokenize(query);
  const hasQuery = query.trim().length > 0;

  const sessionsAfterCity = cityFilter === "all" ? sessionResults : sessionResults.filter((r) => r.city === cityFilter);
  const sessionsAfterSource = sourceFilter === "all"
    ? sessionsAfterCity
    : sessionsAfterCity.filter((r) => r.sourceType === sourceFilter);
  const filteredSessions = yearFilter === "all"
    ? sessionsAfterSource
    : sessionsAfterSource.filter((r) => r.year === yearFilter);

  // 親フィルタ（city/source）が変わると子フィルタ（source/year/faction）の選択肢集合が
  // 変わる。前の選択値が新しい選択肢集合に含まれない場合、pill は非表示になるのに
  // state だけ残ってヒット数 0 の矛盾が起きるので "all" にリセットする。

  const membersAfterCity = cityFilter === "all" ? memberResults : memberResults.filter((m) => m.city === cityFilter);
  const filteredMembers = factionFilter === "all"
    ? membersAfterCity
    : membersAfterCity.filter((m) => (m.faction || "無所属") === factionFilter);

  const totalResults = tab === "sessions" ? filteredSessions.length : filteredMembers.length;

  // タブ切替時のフィルタ要件用に、「市フィルタ後の元データ」から集計
  const availableSourceTypes = new Set(sessionsAfterCity.map((r) => r.sourceType));
  const availableFactions = Array.from(
    new Set(membersAfterCity.map((m) => m.faction || "無所属"))
  ).filter(Boolean).sort();
  // 年度は sourceFilter 適用後から集計し、降順（新しい順）で並べる
  const availableYears = Array.from(
    new Set(sessionsAfterSource.map((r) => r.year).filter(Boolean))
  ).sort((a, b) => (a < b ? 1 : -1));

  // 親フィルタ変更で選択肢から外れた子フィルタ state を "all" にリセット。
  // 依存配列には primitive 化したキーを渡して、配列の reference だけで
  // 再発火しないようにする。
  const availableSourcesKey = Array.from(availableSourceTypes).sort().join("|");
  const availableYearsKey = availableYears.join("|");
  const availableFactionsKey = availableFactions.join("|");
  useEffect(() => {
    if (sourceFilter !== "all" && !availableSourceTypes.has(sourceFilter)) {
      setSourceFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSourcesKey]);
  useEffect(() => {
    if (yearFilter !== "all" && !availableYears.includes(yearFilter)) {
      setYearFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYearsKey]);
  useEffect(() => {
    if (factionFilter !== "all" && !availableFactions.includes(factionFilter)) {
      setFactionFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableFactionsKey]);

  return (
    <div className="flex flex-col gap-4">
      {/* 検索ボックス */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#718096]"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワードを入力（例: プール授業、市営住宅）"
          className="w-full pl-9 pr-4 py-3 border border-[#CBD5E0] rounded-lg text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:border-[#2A5298]"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718096] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded" aria-label="検索をクリア">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* 市フィルタ */}
      {hasQuery && (sessionResults.length > 0 || memberResults.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCityFilter("all")}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
              cityFilter === "all"
                ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
            }`}
          >
            すべての市
          </button>
          {ALL_CITIES.filter((c) =>
            sessionResults.some((r) => r.city === c.id) ||
            memberResults.some((m) => m.city === c.id)
          ).map((c) => (
            <button
              key={c.id}
              onClick={() => setCityFilter(cityFilter === c.id ? "all" : c.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                cityFilter === c.id
                  ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* タブ */}
      <div className="flex border-b border-[#E2E8F0]">
        {(["sessions", "members"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded-t ${
              tab === t
                ? "border-[#1B3A6B] text-[#1B3A6B]"
                : "border-transparent text-[#718096] hover:text-[#1A202C]"
            }`}
            aria-current={tab === t ? "true" : undefined}
          >
            {t === "sessions" ? "議会記録" : "議員"}
            {hasQuery && !loading && (
              <span className="ml-1.5 text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded-full">
                {t === "sessions" ? filteredSessions.length : filteredMembers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 種別フィルタ (議会記録タブのみ) */}
      {tab === "sessions" && hasQuery && availableSourceTypes.size > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "minutes", "session", "decision"] as SourceFilter[])
            .filter((s) => s === "all" || availableSourceTypes.has(s))
            .map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                  sourceFilter === s
                    ? "bg-[#2A5298] text-white border-[#2A5298]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#2A5298] hover:text-[#2A5298]"
                }`}
              >
                {SOURCE_FILTER_LABELS[s]}
                <span className="ml-1 opacity-75">
                  {s === "all"
                    ? sessionsAfterCity.length
                    : sessionsAfterCity.filter((r) => r.sourceType === s).length}
                </span>
              </button>
            ))}
        </div>
      )}

      {/* 年度フィルタ (議会記録タブのみ) */}
      {tab === "sessions" && hasQuery && availableYears.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setYearFilter("all")}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
              yearFilter === "all"
                ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
            }`}
          >
            全期間
            <span className="ml-1 opacity-75">{sessionsAfterSource.length}</span>
          </button>
          {availableYears.map((y) => (
            <button
              key={y}
              onClick={() => setYearFilter(yearFilter === y ? "all" : y)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                yearFilter === y
                  ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
              }`}
            >
              {y}年
              <span className="ml-1 opacity-75">
                {sessionsAfterSource.filter((r) => r.year === y).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 会派フィルタ (議員タブのみ) */}
      {tab === "members" && hasQuery && availableFactions.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFactionFilter("all")}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
              factionFilter === "all"
                ? "bg-[#2A5298] text-white border-[#2A5298]"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#2A5298] hover:text-[#2A5298]"
            }`}
          >
            すべての会派
            <span className="ml-1 opacity-75">{membersAfterCity.length}</span>
          </button>
          {availableFactions.map((f) => (
            <button
              key={f}
              onClick={() => setFactionFilter(factionFilter === f ? "all" : f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                factionFilter === f
                  ? "bg-[#2A5298] text-white border-[#2A5298]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#2A5298] hover:text-[#2A5298]"
              }`}
            >
              {f}
              <span className="ml-1 opacity-75">
                {membersAfterCity.filter((m) => (m.faction || "無所属") === f).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 状態表示 */}
      {!hasQuery && (
        <p className="text-sm text-[#718096] text-center py-8">キーワードを入力してください</p>
      )}

      {hasQuery && loading && (
        <div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
          <span className="sr-only">検索中...</span>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-[#E2E8F0] px-4 py-3 animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-4 w-16 rounded bg-[#E8EEF7]" />
                <div className="h-3 w-20 rounded bg-[#F4F6F9]" />
                <div className="h-3 w-12 rounded bg-[#F4F6F9] ml-auto" />
              </div>
              <div className="h-4 w-3/4 rounded bg-[#E2E8F0] mb-2" />
              <div className="h-3 w-full rounded bg-[#F4F6F9] mb-1" />
              <div className="h-3 w-5/6 rounded bg-[#F4F6F9]" />
            </div>
          ))}
        </div>
      )}

      {hasQuery && !loading && totalResults === 0 && (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          <p className="text-sm">「{query.trim()}」の検索結果はありませんでした</p>
          <p className="text-xs mt-1">別のキーワードでお試しください</p>
        </div>
      )}

      {/* 議員サジェスト: sessions タブで議員名がマッチした場合、議員タブへの動線を上部に出す */}
      {tab === "sessions" && hasQuery && !loading && filteredMembers.length > 0 && (
        <div className="bg-[#E8EEF7] border border-[#C5D0E6] rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-[#1B3A6B] flex-1 min-w-0">
            <span className="font-semibold">議員</span>の検索結果が
            <span className="font-bold mx-0.5">{filteredMembers.length}</span>
            件あります:{" "}
            <span className="text-[#4A5568]">
              {filteredMembers.slice(0, 3).map((m) => `${m.name}（${m.cityName}）`).join(" / ")}
              {filteredMembers.length > 3 && " ほか"}
            </span>
          </p>
          <button
            onClick={() => setTab("members")}
            className="shrink-0 text-xs font-medium px-3 py-1 bg-[#1B3A6B] text-white rounded hover:bg-[#2A5298] transition-colors"
          >
            議員タブを見る
          </button>
        </div>
      )}

      {hasQuery && !loading && truncated && (
        <div className="bg-[#FFF7E6] border border-[#F7C948] rounded px-3 py-2 text-xs text-[#78451F] flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            検索結果が上限（各カテゴリ200件）に達しました。キーワードを追加するか、
            市町村・種別・年度などのフィルタで絞り込んでください。
          </span>
        </div>
      )}

      {/* 議会記録結果 */}
      {tab === "sessions" && hasQuery && !loading && filteredSessions.length > 0 && (
        <div className="flex flex-col gap-3">
          {filteredSessions.map((r, i) => (
            <Link
              key={i}
              href={r.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">{r.cityName}</span>
                {r.sourceType === "minutes" ? (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded border border-[#E2E8F0]">公式議事録</span>
                ) : r.sourceType === "decision" ? (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded border border-[#E2E8F0]">議決結果</span>
                ) : (
                  <span className="text-xs bg-[#E8EEF7] text-[#2A5298] px-1.5 py-0.5 rounded">会議録</span>
                )}
                {r.committee && r.sourceType !== "decision" && (
                  <span className="text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded">{r.committee}</span>
                )}
                {r.label && (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded">{r.label}{r.startTime ? ` ${r.startTime}〜` : ""}</span>
                )}
                <span className="text-xs text-[#718096] ml-auto">{r.field}</span>
              </div>
              <p className="text-sm font-medium text-[#1B3A6B] mb-1">{r.title}</p>
              <p className="text-xs text-[#4A5568] leading-relaxed">
                <Highlight text={r.context} tokens={tokens} />
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* 議員結果 */}
      {tab === "members" && hasQuery && !loading && filteredMembers.length > 0 && (
        <div className="flex flex-col gap-2">
          {filteredMembers.map((m, i) => (
            <Link
              key={i}
              href={m.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-bold text-[#1B3A6B] text-base">
                      <Highlight text={m.name} tokens={tokens} />
                    </span>
                    <span className="text-xs text-[#718096] ml-1.5">{m.furigana}</span>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5 flex-shrink-0">{m.cityName}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full">
                    <Highlight text={m.party} tokens={tokens} />
                  </span>
                )}
                {m.faction && m.faction !== m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full">
                    <Highlight text={m.faction} tokens={tokens} />
                  </span>
                )}
                {m.committees.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#1B3A6B] rounded-full">
                    <Highlight text={c} tokens={tokens} />
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchClient() {
  return (
    <Suspense>
      <SearchClientInner />
    </Suspense>
  );
}
