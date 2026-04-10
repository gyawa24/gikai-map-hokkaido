"use client";

type QA = { q: string; a: string };
type TopicCard = {
  theme: string;
  icon: string;
  color: string;
  summary: string;
  qa: QA[];
};
type Detail = {
  speaker: string;
  overview: string;
  topics: TopicCard[];
};

export default function SegmentDetail({ detail }: { detail: Detail }) {
  return (
    <div className="rounded-xl overflow-hidden border border-[#CBD5E0] shadow-sm bg-white">
      {/* ヘッダー */}
      <div className="bg-[#1B3A6B] px-5 py-4">
        <p className="text-xs font-bold text-[#F7C948] mb-1 tracking-wider uppercase">議会質疑ダイジェスト</p>
        <p className="text-white font-bold text-base leading-snug">{detail.speaker}</p>
        <p className="text-blue-200 text-sm mt-2 leading-relaxed">{detail.overview}</p>
      </div>

      {/* トピック一覧 */}
      <div className="divide-y divide-[#E2E8F0]">
        {detail.topics.map((topic, i) => (
          <div key={i} className="px-5 py-4">
            {/* テーマ見出し */}
            <div className="flex items-center gap-2.5 mb-3">
              <span
                className="text-xl w-9 h-9 flex items-center justify-center rounded-lg flex-shrink-0"
                style={{ backgroundColor: topic.color + "22" }}
              >
                {topic.icon}
              </span>
              <div>
                <p className="text-sm font-bold" style={{ color: topic.color }}>{topic.theme}</p>
                <p className="text-xs text-[#718096] leading-snug mt-0.5">{topic.summary}</p>
              </div>
            </div>

            {/* Q&A */}
            <div className="flex flex-col gap-2.5 ml-1">
              {topic.qa.map((qa, j) => (
                <div key={j} className="flex flex-col gap-1">
                  <div className="flex gap-2 items-start">
                    <span
                      className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: topic.color + "20", color: topic.color }}
                    >Q</span>
                    <p className="text-sm text-[#1A202C] leading-relaxed">{qa.q}</p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 bg-[#E8EEF7] text-[#1B3A6B]">A</span>
                    <p className="text-sm text-[#4A5568] leading-relaxed">{qa.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
