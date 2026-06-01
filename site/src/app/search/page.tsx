import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import JsonLd from "@/components/JsonLd";
import { getAllTags } from "@/lib/topics";
import { slugForTag } from "@/lib/topicAliases";
import { buildBreadcrumbList } from "@/lib/structuredData";
import SearchClient from "@/components/SearchClient";

export const metadata = buildPageMetadata({
  title: "横断検索",
  description:
    "北海道の市町村議会・北海道議会の議事録、議決結果、議員名をキーワードで横断検索できます。テーマや自治体からも探せます。",
  path: "/search",
});

export const dynamic = "force-static";

export default function SearchPage() {
  const topTags = getAllTags().slice(0, 10);
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: "議事録・議員検索", path: "/search" },
  ]);

  return (
    <div className="page-shell max-w-6xl">
      <JsonLd data={breadcrumb} />
      <div className="mb-4">
        <h1 className="theme-section-title text-2xl">横断検索</h1>
        <p className="mt-1 text-base leading-relaxed text-[#4A5568]">
          議事録、議員、議決結果をまとめて探せます。予算書は各市町村の予算ページから原本画像とOCR結果を確認できます。
        </p>
      </div>

      <noscript>
        <form action="/search" method="get" className="mb-4 rounded-lg border border-[#CBD5E0] bg-white p-4">
          <label htmlFor="noscript-search" className="block text-sm font-bold text-[#1B3A6B]">
            キーワード検索
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="noscript-search"
              name="q"
              placeholder="給食無償化、除雪、ラピダス、防災、議員名で検索"
              className="theme-input px-4 py-3 text-base"
            />
            <button type="submit" className="theme-button theme-button-accent min-h-11 px-5 py-2 text-sm">
              検索
            </button>
          </div>
        </form>
      </noscript>

      <SearchClient />

      <section className="mt-6 rounded-lg border border-[#D8DEE8] bg-white px-4 py-4">
        {topTags.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-[#475569]">テーマ別入口</p>
            <p className="mb-2 text-sm leading-relaxed text-[#64748B]">
              よく出るテーマを先にまとめた入口です。詳しく絞るときは、このページの検索窓に戻れます。
            </p>
            <div className="flex flex-wrap gap-2">
              {topTags.map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/topics/${slugForTag(tag)}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[#E8EEF7] px-3 py-1.5 text-sm font-bold text-[#2A5298] transition-colors hover:bg-[#1B3A6B] hover:text-white"
                >
                  <span>{tag}</span>
                  <span className="text-xs opacity-75">{count}件</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
