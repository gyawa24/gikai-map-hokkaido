import fs from "fs";
import path from "path";
import Link from "next/link";
import type { SessionSummary } from "@/types/session";

function getSessions(): SessionSummary[] {
  const fp = path.join(process.cwd(), "data", "chitose", "sessions", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as SessionSummary[];
  } catch {
    return [];
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function ChitoseSessionsPage() {
  const sessions = getSessions();

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">会議録・速報</h2>
        <p className="text-base text-[#4A5568] leading-relaxed mb-3">
          YouTube中継動画の文字起こしと要約を掲載しています。公式議事録の発行（約2ヶ月後）までの速報版です。
        </p>
        <Link
          href="/chitose/minutes"
          className="inline-flex items-center gap-1.5 text-sm text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          公式議事録はこちら
        </Link>
      </section>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている動画はありません。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/chitose/sessions/${s.id}`}
              className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] p-5 shadow-sm hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start gap-4">
                {/* YouTube サムネイル */}
                <div className="shrink-0 w-24 h-16 rounded overflow-hidden bg-[#E8EEF7] relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://img.youtube.com/vi/${s.youtube_id}/mqdefault.jpg`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {s.committee && (
                    <p className="text-xs text-[#718096] mb-0.5">{s.committee}</p>
                  )}
                  <h3 className="text-base font-bold text-[#1A202C] leading-snug mb-1">
                    {s.title}
                  </h3>
                  <p className="text-sm text-[#4A5568]">{formatDate(s.date)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.has_summary ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full font-medium">
                        ✦ 要約あり
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#718096] rounded-full">
                        要約準備中
                      </span>
                    )}
                    {s.segment_count > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#718096] rounded-full">
                        {s.segment_count}部構成
                      </span>
                    )}
                  </div>
                </div>

                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 mt-0.5 transition-colors"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
