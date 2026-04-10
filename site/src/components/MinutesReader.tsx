"use client";

import { useState, useEffect, useRef } from "react";
import type { MinutesSession, MinuteItem } from "@/types/minutes";

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

function groupMatchesTopic(group: AgendaGroup, topic: string): boolean {
  const kw = topic.toLowerCase();
  if (group.title.toLowerCase().includes(kw)) return true;
  return group.items.some(
    (m) => m.text.toLowerCase().includes(kw) || m.title.toLowerCase().includes(kw)
  );
}

function groupMatchesQuery(group: AgendaGroup, query: string): boolean {
  const q = query.toLowerCase();
  if (group.title.toLowerCase().includes(q)) return true;
  return group.items.some(
    (m) => m.text.toLowerCase().includes(q) || m.title.toLowerCase().includes(q)
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

function MinuteItemView({ item, highlight }: { item: MinuteItem; highlight?: string }) {
  const [expanded, setExpanded] = useState(false);
  const style = getItemStyle(item.minute_type);
  const isLong = item.text.length > 400;
  const displayText = isLong && !expanded ? item.text.slice(0, 400) + "…" : item.text;

  // ハイライト表示
  const renderText = (text: string) => {
    if (!highlight) return <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>;
    const kw = highlight.toLowerCase();
    const idx = text.toLowerCase().indexOf(kw);
    if (idx === -1) return <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>;
    return (
      <p style={{ whiteSpace: "pre-wrap" }}>
        {text.slice(0, idx)}
        <mark className="bg-yellow-100 text-[#1A202C] rounded px-0.5">
          {text.slice(idx, idx + highlight.length)}
        </mark>
        {text.slice(idx + highlight.length)}
      </p>
    );
  };

  return (
    <div className={`pb-3 last:pb-0 ${style.wrapperClass}`}>
      <div className="flex items-center gap-2 mb-1">
        {style.label && (
          <span className={`shrink-0 ${style.labelClass}`}>{style.label}</span>
        )}
        <span className="text-sm font-semibold text-[#1A202C]">{item.title}</span>
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
  activeTopic,
  query,
}: {
  group: AgendaGroup;
  defaultOpen: boolean;
  activeTopic: string | null;
  query: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  // activeTopic / query が変わったら開閉を同期
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  // 自動スクロール（マッチしていて展開されたとき）
  useEffect(() => {
    if (defaultOpen && (activeTopic || query)) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [defaultOpen, activeTopic, query]);

  const visibleItems = group.items.filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return m.text.toLowerCase().includes(q) || m.title.toLowerCase().includes(q);
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
  activeTopic?: string | null;
  initialQuery?: string;
};

export default function MinutesReader({ session, activeTopic = null, initialQuery = "" }: Props) {
  const [activeScheduleIndex, setActiveScheduleIndex] = useState(0);
  const [query, setQuery] = useState(initialQuery);

  const activeSchedule = session.schedules[activeScheduleIndex];
  const groups = buildAgendaGroups(activeSchedule.minutes);

  const filter = activeTopic ?? query.trim();

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
            {session.schedules.map((s, i) => (
              <button
                key={s.schedule_id}
                onClick={() => { setActiveScheduleIndex(i); setQuery(""); }}
                className={`
                  text-sm px-3 py-2 font-medium whitespace-nowrap border-b-2 -mb-px transition-colors
                  ${i === activeScheduleIndex
                    ? "border-[#1B3A6B] text-[#1B3A6B]"
                    : "border-transparent text-[#4A5568] hover:text-[#1B3A6B] hover:border-[#CBD5E0]"
                  }
                `}
              >
                {parseScheduleName(s.name)}
              </button>
            ))}
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="この日の議事録内を検索…"
            className="w-full pl-9 pr-9 py-2 text-base border border-[#CBD5E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] placeholder:text-[#A0AEC0]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
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
          visibleGroups.map((group) => {
            const isMatch = filter
              ? (activeTopic ? groupMatchesTopic(group, activeTopic) : groupMatchesQuery(group, query.trim()))
              : false;
            return (
              <AgendaGroupView
                key={group.id}
                group={group}
                defaultOpen={isMatch}
                activeTopic={activeTopic}
                query={query.trim()}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
