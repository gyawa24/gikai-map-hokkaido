"use client";

import { useState, useEffect, useEffectEvent, useRef, useMemo } from "react";
import { useToast } from "./Toast";
import type { MinutesSession, MinuteItem } from "@/types/minutes";
import LikeButton from "./LikeButton";

// ---------- ユーティリティ ----------

function parseScheduleName(name: string): string {
  const m = name.match(/(\d+)月(\d+)日[－\-](\d+)号/);
  if (m) return `${parseInt(m[1])}月${parseInt(m[2])}日（第${parseInt(m[3])}号）`;
  return name;
}

// ---------- 議題グループ ----------

type AgendaGroup = {
  id: string;
  title: string;
  items: MinuteItem[];
};

function buildAgendaGroups(minutes: MinuteItem[]): AgendaGroup[] {
  const groups: AgendaGroup[] = [];
  let current: AgendaGroup | null = null;

  for (const m of minutes) {
    if (m.minute_type === "名簿") continue;

    if (m.minute_type === "△議題") {
      if (current) groups.push(current);
      current = {
        id: String(m.minute_id),
        title: m.text.replace(/^△/, "").trim(),
        items: [],
      };
    } else {
      if (!current) {
        current = { id: "header", title: "", items: [] };
      }
      current.items.push(m);
    }
  }
  if (current) groups.push(current);
  return groups.filter((g) => g.title || g.items.length > 0);
}

/**
 * 長いトピック文字列から検索キーワードを抽出する。
 * 「次世代半導体関連事業の使用物質・薬品」→ ["次世代半導体関連事業", "使用物質", "薬品"]
 * 短い文字列（8文字以下）はそのまま返す。
 */
function extractKeywords(text: string): string[] {
  if (text.length <= 5) return [text];
  const parts = text.split(/[のがをにでとはもやてからより・、。「」【】（）\s]+/);
  // ひらがなのみの断片（助詞・活用語尾）は除外する
  const keywords = parts.filter((p) => p.length >= 2 && !/^[\u3041-\u3096]+$/.test(p));
  return keywords.length > 0 ? keywords : [text];
}

function textMatchesKeywords(target: string, keywords: string[]): boolean {
  const lower = target.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// スペース区切りトークン → AND検索、単語 → extractKeywordsでOR検索
function queryTokens(query: string): string[] {
  const spaceTokens = query.trim().split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1) return spaceTokens; // AND用
  return extractKeywords(query); // OR用（助詞除去）
}

function textMatchesQuery(target: string, query: string): boolean {
  const spaceTokens = query.trim().split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1) {
    // AND: 全トークンが含まれること
    const lower = target.toLowerCase();
    return spaceTokens.every((t) => lower.includes(t.toLowerCase()));
  }
  return textMatchesKeywords(target, extractKeywords(query));
}

function groupMatchesTopic(group: AgendaGroup, topic: string): boolean {
  const keywords = extractKeywords(topic);
  if (textMatchesKeywords(group.title, keywords)) return true;
  return group.items.some(
    (m) => textMatchesKeywords(m.text, keywords) || textMatchesKeywords(m.title, keywords)
  );
}

function groupMatchesQuery(group: AgendaGroup, query: string): boolean {
  if (textMatchesQuery(group.title, query)) return true;
  return group.items.some(
    (m) => textMatchesQuery(m.text, query) || textMatchesQuery(m.title, query)
  );
}

// ---------- 発言アイテムのスタイル ----------

type ItemStyle = {
  label: string | null;
  labelClass: string;
  textClass: string;
  wrapperClass: string;
};

function getItemStyle(minuteType: string): ItemStyle {
  if (minuteType === "◆質問" || minuteType === "○一般質問") {
    return {
      label: "質問",
      labelClass: "text-xs font-bold text-[#2A5298] bg-[#E8EEF7] px-1.5 py-0.5 rounded",
      textClass: "text-base text-[#1A202C] leading-relaxed",
      wrapperClass: "border-l-2 border-[#2A5298] pl-3",
    };
  }
  if (minuteType === "◎答弁" || minuteType === "◎市長") {
    return {
      label: "答弁",
      labelClass: "text-xs font-bold text-[#276749] bg-[#F0FFF4] px-1.5 py-0.5 rounded border border-[#C6F6D5]",
      textClass: "text-base text-[#1A202C] leading-relaxed",
      wrapperClass: "border-l-2 border-[#68D391] pl-3",
    };
  }
  if (minuteType === "○議長") {
    return {
      label: "議長",
      labelClass: "text-xs font-medium text-[#718096] bg-[#F4F6F9] px-1.5 py-0.5 rounded border border-[#E2E8F0]",
      textClass: "text-sm text-[#4A5568] leading-relaxed",
      wrapperClass: "opacity-60",
    };
  }
  return {
    label: null,
    labelClass: "",
    textClass: "text-base text-[#1A202C] leading-relaxed",
    wrapperClass: "",
  };
}

function MinuteItemView({
  item,
  highlight,
  anchorId,
  citationContext,
  likeTarget,
}: {
  item: MinuteItem;
  highlight?: string;
  anchorId: string;
  citationContext: { cityName: string; councilName: string; scheduleName: string };
  likeTarget?: { slug: string; council_id: number; schedule_id: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const style = getItemStyle(item.minute_type);
  const isLong = item.text.length > 400;
  const displayText = isLong && !expanded ? item.text.slice(0, 400) + "…" : item.text;

  // ハイライト表示（全マッチキーワードをハイライト）
  const renderText = (text: string) => {
    if (!highlight) return <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>;
    const keywords = queryTokens(highlight);
    const pattern = keywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const regex = new RegExp(`(${pattern})`, "gi");
    const checkRe = new RegExp(`^(?:${pattern})$`, "i");
    const parts = text.split(regex);
    return (
      <p style={{ whiteSpace: "pre-wrap" }}>
        {parts.map((part, i) =>
          checkRe.test(part) ? (
            <mark key={i} className="bg-yellow-100 text-[#1A202C] rounded px-0.5">{part}</mark>
          ) : (
            part
          )
        )}
      </p>
    );
  };

  const buildPermalink = () => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}#${anchorId}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildPermalink());
      toast.show("発言リンクをコピーしました");
    } catch {
      toast.show("コピーに失敗しました", "info");
    }
  };

  const handleCopyCitation = async () => {
    const { cityName, councilName, scheduleName } = citationContext;
    const header = `${item.title}（${cityName}議会 ${councilName} ${scheduleName}）`;
    const block = `${header}\n\n${item.text}\n\n出典: ${buildPermalink()}`;
    try {
      await navigator.clipboard.writeText(block);
      toast.show("出典つきの本文をコピーしました");
    } catch {
      toast.show("コピーに失敗しました", "info");
    }
  };

  return (
    <div id={anchorId} className={`scroll-mt-20 pb-3 last:pb-0 ${style.wrapperClass}`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {style.label && (
          <span className={`shrink-0 ${style.labelClass}`}>{style.label}</span>
        )}
        <span className="text-sm font-semibold text-[#1A202C] flex-1 min-w-0">
          {item.title}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyLink}
            className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-0.5 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            title="この発言へのリンクをコピー"
            aria-label="この発言へのリンクをコピー"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span className="hidden sm:inline">リンク</span>
          </button>
          <button
            onClick={handleCopyCitation}
            className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-0.5 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            title="出典付きで本文をコピー（議員の発信用）"
            aria-label="出典付きで本文をコピー"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="hidden sm:inline">引用</span>
          </button>
          {likeTarget && (
            <LikeButton
              size="sm"
              target={{
                kind: "minute",
                slug: likeTarget.slug,
                council_id: likeTarget.council_id,
                schedule_id: likeTarget.schedule_id,
                minute_id: item.minute_id,
              }}
            />
          )}
        </div>
      </div>
      <div className={style.textClass}>
        {renderText(displayText)}
        {isLong && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-sm text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
          >
            {expanded ? "折りたたむ" : "続きを読む"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- 議題グループ（折りたたみ） ----------

function AgendaGroupView({
  group,
  defaultOpen,
  scrollTo,
  activeTopic,
  query,
  scheduleId,
  citationContext,
  likeTarget,
}: {
  group: AgendaGroup;
  defaultOpen: boolean;
  scrollTo: boolean;
  activeTopic: string | null;
  query: string;
  scheduleId: number;
  citationContext: { cityName: string; councilName: string; scheduleName: string };
  likeTarget?: { slug: string; council_id: number };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  // activeTopic / query が変わったら開閉を同期
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  // 自動スクロール（最初のマッチグループのみ）
  useEffect(() => {
    if (scrollTo && (activeTopic || query)) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollTo, activeTopic, query]);

  // グループタイトル自体がクエリにマッチしている場合（例: 「松倉美加議員の代表質問」）は
  // アイテムを全件表示する。内容フィルターはアイテムレベルのマッチ時のみ適用。
  const titleMatches = query ? textMatchesQuery(group.title, query) : false;
  const visibleItems = group.items.filter((m) => {
    if (!query || titleMatches) return true;
    return textMatchesQuery(m.text, query) || textMatchesQuery(m.title, query);
  });

  const hasContent = visibleItems.length > 0;

  return (
    <div ref={ref} className="border border-[#E2E8F0] rounded-lg overflow-hidden">
      {/* ヘッダー（トグル） */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          open ? "bg-[#E8EEF7]" : "bg-white hover:bg-[#F4F6F9]"
        }`}
      >
        <svg
          className={`w-4 h-4 shrink-0 text-[#718096] transition-transform ${open ? "" : "-rotate-90"}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className={`text-sm font-semibold flex-1 leading-snug ${open ? "text-[#1B3A6B]" : "text-[#1A202C]"}`}>
          {group.title || "（冒頭）"}
        </span>
        {hasContent && (
          <span className="text-xs text-[#718096] shrink-0">{group.items.length}件</span>
        )}
        {/* マッチバッジ */}
        {(activeTopic && groupMatchesTopic(group, activeTopic)) && (
          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full font-medium shrink-0">
            {activeTopic}
          </span>
        )}
      </button>

      {/* 本文 */}
      {open && (
        <div className="px-4 py-4 bg-white border-t border-[#E2E8F0] space-y-4">
          {visibleItems.length === 0 ? (
            <p className="text-sm text-[#718096]">この日程に一致する発言はありません</p>
          ) : (
            visibleItems.map((item) => (
              <MinuteItemView
                key={item.minute_id}
                item={item}
                highlight={activeTopic ?? (query || undefined)}
                anchorId={`minute-${scheduleId}-${item.minute_id}`}
                citationContext={citationContext}
                likeTarget={likeTarget ? { ...likeTarget, schedule_id: scheduleId } : undefined}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------- メインコンポーネント ----------

type Props = {
  session: MinutesSession;
  cityName: string;
  slug?: string;
  activeTopic?: string | null;
  query: string;
  onQueryChange: (q: string) => void;
};

export default function MinutesReader({ session, cityName, slug, activeTopic = null, query, onQueryChange }: Props) {
  const [activeScheduleIndex, setActiveScheduleIndex] = useState(0);

  // 引用URLで来たとき (#minute-{scheduleId}-{minuteId}) は対応する日程タブを開いてスクロールする
  const handleHashNavigation = useEffectEvent(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/^#minute-(\d+)-(\d+)/);
    if (!m) return;
    const targetScheduleId = Number(m[1]);
    const idx = session.schedules.findIndex((s) => s.schedule_id === targetScheduleId);
    if (idx === -1) return;
    setActiveScheduleIndex(idx);
    requestAnimationFrame(() => {
      const el = document.getElementById(window.location.hash.slice(1));
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => handleHashNavigation();
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const filter = activeTopic ?? query.trim();

  // 各タブのマッチ件数（フィルター時のみ計算）
  const matchCountsPerTab = useMemo(() => {
    if (!filter) return null;
    return session.schedules.map((s) => {
      const gs = buildAgendaGroups(s.minutes);
      return gs.filter((g) =>
        activeTopic ? groupMatchesTopic(g, activeTopic) : groupMatchesQuery(g, query.trim())
      ).length;
    });
  }, [filter, activeTopic, query, session.schedules]);

  const effectiveActiveScheduleIndex = useMemo(() => {
    if (!filter || !matchCountsPerTab) return activeScheduleIndex;
    const firstMatch = matchCountsPerTab.findIndex((c) => c > 0);
    if (firstMatch === -1) return activeScheduleIndex;
    return matchCountsPerTab[activeScheduleIndex] === 0 ? firstMatch : activeScheduleIndex;
  }, [activeScheduleIndex, filter, matchCountsPerTab]);

  const activeSchedule = session.schedules[effectiveActiveScheduleIndex];
  const groups = buildAgendaGroups(activeSchedule.minutes);
  const citationContext = {
    cityName,
    councilName: session.name,
    scheduleName: parseScheduleName(activeSchedule.name),
  };

  // フィルター適用後のグループ
  const visibleGroups = filter
    ? groups.filter((g) =>
        activeTopic
          ? groupMatchesTopic(g, activeTopic)
          : groupMatchesQuery(g, query.trim())
      )
    : groups;

  const matchCount = visibleGroups.length;

  return (
    <div>
      {/* スケジュールタブ */}
      <div className="mb-5">
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex gap-1 min-w-max border-b border-[#CBD5E0]">
            {session.schedules.map((s, i) => {
              const tabCount = matchCountsPerTab?.[i] ?? 0;
              return (
                <button
                  key={s.schedule_id}
                  onClick={() => setActiveScheduleIndex(i)}
                  className={`
                    relative text-sm px-3 py-2 font-medium whitespace-nowrap border-b-2 -mb-px transition-colors
                    ${i === activeScheduleIndex
                      ? "border-[#1B3A6B] text-[#1B3A6B]"
                      : "border-transparent text-[#4A5568] hover:text-[#1B3A6B] hover:border-[#CBD5E0]"
                    }
                  `}
                >
                  {parseScheduleName(s.name)}
                  {matchCountsPerTab && tabCount > 0 && (
                    <span className="ml-1.5 text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded-full">
                      {tabCount}
                    </span>
                  )}
                  {matchCountsPerTab && tabCount === 0 && filter && (
                    <span className="ml-1.5 text-xs text-[#CBD5E0]">0</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* テキスト検索 */}
      <div className="mb-4">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#718096] pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="この日の議事録内を検索…"
            className="w-full pl-9 pr-9 py-2 text-base border border-[#CBD5E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] placeholder:text-[#A0AEC0]"
          />
          {query && (
            <button
              onClick={() => onQueryChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718096] hover:text-[#1A202C]"
              aria-label="検索をクリア"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* フィルター状態の表示 */}
      {filter && (
        <div className="mb-3 flex items-center gap-2">
          <p className="text-sm text-[#4A5568]">
            <span className="font-semibold text-[#1B3A6B]">「{filter}」</span>
            に関連する日程：{matchCount}件
          </p>
          {matchCount === 0 && (
            <span className="text-xs text-[#718096]">（別の日程を確認してください）</span>
          )}
        </div>
      )}

      {/* 議題グループ一覧 */}
      <div className="space-y-2">
        {visibleGroups.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
            この日程に「{filter}」に関連する内容は見つかりませんでした
          </div>
        ) : (
          visibleGroups.map((group, i) => {
            const isMatch = filter
              ? (activeTopic ? groupMatchesTopic(group, activeTopic) : groupMatchesQuery(group, query.trim()))
              : false;
            return (
              <AgendaGroupView
                key={group.id}
                group={group}
                defaultOpen={isMatch}
                scrollTo={isMatch && i === 0}
                activeTopic={activeTopic}
                query={query.trim()}
                scheduleId={activeSchedule.schedule_id}
                citationContext={citationContext}
                likeTarget={slug ? { slug, council_id: session.council_id } : undefined}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
