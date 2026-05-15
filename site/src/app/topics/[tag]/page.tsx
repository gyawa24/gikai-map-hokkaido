import Link from "next/link";
import { aliasesForTag, canonicalizeTag, getByTag } from "@/lib/topics";
import AIDisclaimer from "@/components/AIDisclaimer";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

type Props = {
  params: Promise<{ tag: string }>;
};

function decodeTagParam(tag: string) {
  try {
    return decodeURIComponent(tag);
  } catch {
    return tag;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const decoded = decodeTagParam(tag);
  const canonical = canonicalizeTag(decoded);
  return buildPageMetadata({
    title: `${canonical} - テーマ別議事録`,
    description: `北海道内の市町村議会で「${canonical}」に関連する議事録の一覧です。自治体を横断して確認できます。`,
    path: `/topics/${encodeURIComponent(canonical)}`,
  });
}

// 日本語タグを ISR/static の cache tag に載せると Vercel のヘッダー生成で失敗するため、
// ASCII slug 化するまでタグ詳細はリクエストごとに描画する。
export const dynamic = "force-dynamic";

export default async function TopicTagPage({ params }: Props) {
  const { tag } = await params;
  const decoded = decodeTagParam(tag);
  const canonical = canonicalizeTag(decoded);
  const aliases = aliasesForTag(canonical).filter((alias) => alias !== canonical);
  const records = getByTag(decoded);
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: "テーマ別議事録", path: "/topics" },
    { name: canonical, path: `/topics/${encodeURIComponent(canonical)}` },
  ]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <JsonLd data={breadcrumb} />
      {/* パンくずナビ */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/topics" className="hover:text-[#1B3A6B] transition-colors">
          テーマ別議事録
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{canonical}</span>
      </nav>

      <section className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-xl font-bold text-[#1B3A6B]">{canonical}</h2>
          <span className="rounded border border-[#C5D0E6] bg-[#E8EEF7] px-2 py-0.5 text-sm font-semibold text-[#2A5298]">
            議事録 {records.length}件
          </span>
        </div>
        <p className="text-base text-[#4A5568] leading-relaxed">
          「{canonical}」に関連する議事録の一覧です。表記ゆれも含めて、複数の市町村議会から横断的に表示しています。
        </p>
        {aliases.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
            含めている表記: {aliases.join("、")}
          </p>
        )}
      </section>

      <AIDisclaimer sourceLabel="議事録原文" />

      {records.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          <p className="font-semibold text-[#4A5568]">このテーマに該当する議事録はありません。</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href={`/search?q=${encodeURIComponent(canonical)}`} className="theme-button px-4 py-2 text-sm">
              横断検索で探す
            </Link>
            <Link href="/topics" className="theme-button px-4 py-2 text-sm">
              テーマ一覧へ戻る
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((record) => (
            <div
              key={`${record.cityId}-${record.council_id}`}
              className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm transition-colors duration-150 overflow-hidden"
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
                          canonicalizeTag(t) === canonical
                            ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                            : "bg-[#F4F6F9] text-[#4A5568] border-[#E2E8F0] hover:bg-[#E8EEF7] hover:text-[#2A5298]"
                        }`}
                      >
                        {canonicalizeTag(t)}
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
                  該当箇所を見る
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
