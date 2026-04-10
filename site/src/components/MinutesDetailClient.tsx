"use client";

import { useState } from "react";
import type { MinutesSession, MinutesEnriched, MinutesSpeaker } from "@/types/minutes";
import MinutesReader from "./MinutesReader";

const ROLE_ORDER: Record<string, number> = {
  "議長": 0, "市長": 1, "副市長": 2, "議員": 3, "理事者": 4, "その他": 5,
};

type Props = {
  session: MinutesSession;
  enriched: MinutesEnriched | null;
};

export default function MinutesDetailClient({ session, enriched }: Props) {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const memberSpeakers: MinutesSpeaker[] = enriched?.speakers
    .filter((s) => s.role === "議員")
    .sort((a, b) => b.speech_count - a.speech_count) ?? [];

  const officialSpeakers: MinutesSpeaker[] = enriched?.speakers
    .filter((s) => s.role !== "議員" && s.role !== "その他")
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 5) - (ROLE_ORDER[b.role] ?? 5)) ?? [];

  const handleTagClick = (tag: string) => {
    setActiveTopic((prev) => (prev === tag ? null : tag));
  };

  return (
    <>
      {/* AI要約セクション */}
      {enriched ? (
        <section className="mb-6 space-y-4">
          {/* 要約 */}
          <div className="bg-[#E8EEF7] rounded-lg p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-[#2A5298]">✦ AI要約</span>
            </div>
            <p className="text-base text-[#1A202C] leading-relaxed mb-3">
              {enriched.summary}
            </p>
            {enriched.highlights.length > 0 && (
              <ul className="space-y-1">
                {enriched.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#4A5568]">
                    <span className="text-[#2A5298] shrink-0 mt-0.5">·</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* タグ（クリックで絞り込み） */}
          {enriched.tags.length > 0 && (
            <div>
              <p className="text-xs text-[#718096] mb-2">
                タグをクリックすると、関連する質疑の箇所を表示します
              </p>
              <div className="flex flex-wrap gap-1.5">
                {enriched.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleTagClick(tag)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      activeTopic === tag
                        ? "bg-[#1B3A6B] text-white border-[#1B3A6B] shadow-sm"
                        : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
                {activeTopic && (
                  <button
                    onClick={() => setActiveTopic(null)}
                    className="text-xs px-2.5 py-1 rounded-full border border-dashed border-[#CBD5E0] text-[#718096] hover:text-[#1A202C] transition-colors flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    解除
                  </button>
                )}
              </div>
            </div>
          )}

          {/* activeTopic 時のガイド */}
          {activeTopic && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-start gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p className="text-sm text-yellow-800">
                <span className="font-semibold">「{activeTopic}」</span>
                に関連する日程を下の議事録から表示しています。日程名のバッジで確認できます。
              </p>
            </div>
          )}

          {/* 質問議員 */}
          {enriched.questioners.length > 0 && (
            <div className="bg-white rounded-lg border border-[#CBD5E0] p-4 shadow-sm">
              <h3 className="text-sm font-bold text-[#1B3A6B] mb-3">質問に立った議員</h3>
              <div className="space-y-2">
                {enriched.questioners.map((q) => (
                  <div key={q.name} className="flex items-start gap-2">
                    <span className="text-sm font-medium text-[#1A202C] shrink-0 w-28">{q.name}</span>
                    <div className="flex flex-wrap gap-1">
                      {q.topics.map((t) => (
                        <button
                          key={t}
                          onClick={() => handleTagClick(t)}
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                            activeTopic === t
                              ? "bg-[#1B3A6B] text-white"
                              : "bg-[#E8EEF7] text-[#2A5298] hover:bg-[#1B3A6B] hover:text-white"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 執行部 */}
          {officialSpeakers.length > 0 && (
            <div className="bg-white rounded-lg border border-[#CBD5E0] p-4 shadow-sm">
              <h3 className="text-sm font-bold text-[#1B3A6B] mb-3">答弁した執行部</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {officialSpeakers.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="text-xs text-[#718096]">{s.role}</span>
                    <span className="text-sm text-[#1A202C]">{s.name.replace(/[◎○]/g, "")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-[#A0AEC0] text-right">AI要約生成日: {enriched.generated_at}</p>
        </section>
      ) : (
        <div className="mb-6 bg-[#F4F6F9] rounded-lg p-4 border border-dashed border-[#CBD5E0]">
          <p className="text-sm text-[#718096] text-center">
            要約・タグ・発言者リストを準備中です
          </p>
        </div>
      )}

      {/* 議事録リーダー */}
      <MinutesReader session={session} activeTopic={activeTopic} />
    </>
  );
}
