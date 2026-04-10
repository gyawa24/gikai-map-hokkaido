"use client";

import { useState, useCallback } from "react";
import type { MinutesSession, MinuteItem } from "@/types/minutes";

function parseScheduleName(name: string): string {
  const m = name.match(/(\d+)月(\d+)日[－\-](\d+)号/);
  if (m) {
    return `${parseInt(m[1])}月${parseInt(m[2])}日（第${parseInt(m[3])}号）`;
  }
  return name;
}

type MinuteTypeStyle = {
  container: string;
  label: string | null;
  labelClass: string;
  textClass: string;
  skip?: boolean;
};

function getTypeStyle(minuteType: string): MinuteTypeStyle {
  if (minuteType === "名簿") {
    return { container: "", label: null, labelClass: "", textClass: "", skip: true };
  }
  if (minuteType === "△議題") {
    return {
      container: "my-4 first:mt-0",
      label: null,
      labelClass: "",
      textClass: "text-sm font-bold text-[#1B3A6B] bg-[#E8EEF7] px-3 py-1.5 rounded border-l-4 border-[#1B3A6B]",
    };
  }
  if (minuteType === "◆質問" || minuteType === "○一般質問") {
    return {
      container: "pl-0",
      label: "質問",
      labelClass: "text-xs font-bold text-[#2A5298] bg-[#E8EEF7] px-1.5 py-0.5 rounded",
      textClass: "text-base text-[#1A202C] leading-relaxed",
    };
  }
  if (minuteType === "◎答弁" || minuteType === "◎市長") {
    return {
      container: "pl-0",
      label: "答弁",
      labelClass: "text-xs font-bold text-[#276749] bg-[#F0FFF4] px-1.5 py-0.5 rounded border border-[#C6F6D5]",
      textClass: "text-base text-[#1A202C] leading-relaxed",
    };
  }
  if (minuteType === "○議長") {
    return {
      container: "pl-0 opacity-70",
      label: "議長",
      labelClass: "text-xs font-medium text-[#718096] bg-[#F4F6F9] px-1.5 py-0.5 rounded border border-[#E2E8F0]",
      textClass: "text-sm text-[#4A5568] leading-relaxed",
    };
  }
  return {
    container: "pl-0",
    label: null,
    labelClass: "",
    textClass: "text-base text-[#1A202C] leading-relaxed",
  };
}

function MinuteItemView({ item }: { item: MinuteItem }) {
  const style = getTypeStyle(item.minute_type);
  if (style.skip) return null;

  const [expanded, setExpanded] = useState(false);
  const isLong = item.text.length > 400;
  const displayText = isLong && !expanded ? item.text.slice(0, 400) + "…" : item.text;

  if (item.minute_type === "△議題") {
    return (
      <div className={style.container}>
        <p className={style.textClass}>{item.text.replace(/^△/, "").trim()}</p>
      </div>
    );
  }

  return (
    <div className={`border-b border-[#F4F6F9] pb-4 last:border-0 last:pb-0 ${style.container}`}>
      <div className="flex items-start gap-2 mb-1">
        {style.label && (
          <span className={`shrink-0 mt-0.5 ${style.labelClass}`}>{style.label}</span>
        )}
        <span className="text-sm font-semibold text-[#1A202C]">{item.title}</span>
      </div>
      <div className={style.textClass}>
        <p style={{ whiteSpace: "pre-wrap" }}>{displayText}</p>
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

type Props = {
  session: MinutesSession;
};

export default function MinutesReader({ session }: Props) {
  const [activeScheduleIndex, setActiveScheduleIndex] = useState(0);
  const [query, setQuery] = useState("");

  const activeSchedule = session.schedules[activeScheduleIndex];

  const filteredMinutes = useCallback(() => {
    if (!query.trim()) return activeSchedule.minutes;
    const q = query.trim().toLowerCase();
    return activeSchedule.minutes.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q)
    );
  }, [activeSchedule, query])();

  return (
    <div>
      {/* スケジュールタブ */}
      <div className="mb-6">
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex gap-1 min-w-max border-b border-[#CBD5E0] pb-0">
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

      {/* 検索 */}
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
            className="w-full pl-9 pr-4 py-2 text-base border border-[#CBD5E0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] placeholder:text-[#A0AEC0]"
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
        {query && (
          <p className="text-sm text-[#718096] mt-1 ml-1">
            {filteredMinutes.length} 件ヒット
          </p>
        )}
      </div>

      {/* 議事録本文 */}
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm">
        <div className="px-5 py-4 border-b border-[#E2E8F0]">
          <p className="text-sm font-semibold text-[#1B3A6B]">
            {parseScheduleName(activeSchedule.name)}
          </p>
          <p className="text-xs text-[#718096] mt-0.5">
            {activeSchedule.minutes.filter((m) => m.minute_type !== "名簿").length} 件の発言・議題
          </p>
        </div>

        {filteredMinutes.length === 0 ? (
          <div className="px-5 py-10 text-center text-[#718096]">
            <p>「{query}」に一致する内容が見つかりません</p>
          </div>
        ) : (
          <div className="px-5 py-4 flex flex-col gap-4">
            {filteredMinutes.map((item) => (
              <MinuteItemView key={item.minute_id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
