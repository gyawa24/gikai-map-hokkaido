import Link from "next/link";
import { getByTag, getAllTags } from "@/lib/topics";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ tag: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const decoded = tag;
  return {
    title: `${decoded} | テーマ別議事録 | 北海道議会情報マップ`,
    description: `北海道内の市町村議会で「${decoded}」が議論された議事録の一覧です。`,
  };
}

export async function generateStaticParams() {
  const tags = getAllTags();
  return tags.map(({ tag }) => ({ tag }));
}

export default async function TopicTagPage({ params }: Props) {
  const { tag } = await params;
  const decoded = tag;
  const records = getByTag(decoded);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* パンくずナビ */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/topics" className="hover:text-[#1B3A6B] transition-colors">
          テーマ別議事録
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{decoded}</span>
      </nav>

      <section className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-xl font-bold text-[#1B3A6B]">{decoded}</h2>
          <span className="text-xs font-semibold px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded">
            {records.length}件
          </span>
        </div>
        <p className="text-base text-[#4A5568] leading-relaxed">
          「{decoded}」が議題になった議事録の一覧です。複数の市町村議会から横断的に表示しています。
        </p>
      </section>

      {records.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          このテーマに該当する議事録はありません。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((record) => (
            <div
              key={`${record.cityId}-${record.council_id}`}
              className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm hover:shadow-md transition-all duration-150 overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-xs font-semibold px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded shrink-0 mt-0.5">
                    {record.cityName}
                  </span>
                  <Link
                    href={`/${record.cityId}/minutes/${record.council_id}`}
                    className="text-lg font-bold text-[#1A202C] leading-snug hover:text-[#1B3A6B] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
                  >
                    {record.name}
                  </Link>
                </div>

                {record.summary && (
                  <p className="text-base text-[#4A5568] leading-relaxed mb-3">
                    {record.summary}
                  </p>
                )}

                {record.highlights && record.highlights.length > 0 && (
                  <div className="flex items-start gap-2 text-sm text-[#4A5568] mb-3">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4 text-[#2A5298] shrink-0 mt-0.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span>{record.highlights[0]}</span>
                  </div>
                )}

                {record.tags && record.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {record.tags.map((t) => (
                      <Link
                        key={t}
                        href={`/topics/${encodeURIComponent(t)}`}
                        className={`text-xs px-2 py-0.5 border rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                          t === decoded
                            ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                            : "bg-[#F4F6F9] text-[#4A5568] border-[#E2E8F0] hover:bg-[#E8EEF7] hover:text-[#2A5298]"
                        }`}
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[#E2E8F0] px-5 py-2.5 flex justify-end">
                <Link
                  href={`/${record.cityId}/minutes/${record.council_id}`}
                  className="text-sm text-[#2A5298] hover:text-[#1B3A6B] font-medium flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
                >
                  議事録を見る
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
