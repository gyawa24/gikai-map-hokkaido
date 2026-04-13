import Link from "next/link";
import { getAllTags } from "@/lib/topics";

export const metadata = {
  title: "テーマ別議事録 | 北海道議会情報マップ",
  description: "北海道内の市町村議会議事録をテーマ・タグ別に横断検索できます。",
};

export default function TopicsPage() {
  const tags = getAllTags();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">テーマ別議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          北海道内の市町村議会の議事録をテーマ別に横断検索できます。
          タグをクリックすると関連する議事録の一覧を表示します。
        </p>
      </section>

      {tags.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されているテーマはありません。
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-6">
          <div className="flex flex-wrap gap-3">
            {tags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/topics/${encodeURIComponent(tag)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E8EEF7] text-[#2A5298] rounded-full text-sm font-medium hover:bg-[#1B3A6B] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
              >
                <span>{tag}</span>
                <span className="text-xs font-normal opacity-75">（{count}件）</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-sm text-[#718096]">
        全{tags.length}テーマ・{tags.reduce((s, t) => s + t.count, 0)}件の議事録タグ
      </p>
    </div>
  );
}
