import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import JsonLd from "@/components/JsonLd";
import { getAllTags } from "@/lib/topics";
import { buildBreadcrumbList } from "@/lib/structuredData";
import SearchClient from "@/components/SearchClient";

export const metadata = buildPageMetadata({
  title: "横断検索",
  description:
    "北海道の市町村議会・北海道議会の議事録、議決結果、議員名をキーワードで横断検索できます。テーマや自治体からも探せます。",
  path: "/search",
});

export default function SearchPage() {
  const topTags = getAllTags().slice(0, 10);
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: "議事録・議員検索", path: "/search" },
  ]);

  return (
    <div className="page-shell max-w-6xl">
      <JsonLd data={breadcrumb} />
      <div className="mb-5">
        <h1 className="theme-section-title text-2xl">横断検索</h1>
        <p className="mt-1 text-sm text-[#718096]">
          まずはここでまとめて探せます。議事録、議決結果、議員名を同じ検索窓から調べられます。
        </p>
      </div>

      <section className="mb-6 rounded-[22px] border border-[#D8DEE8] bg-white px-4 py-4 shadow-[0_6px_14px_rgba(27,58,107,0.05)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-lg font-black text-[#111827]">検索の入口</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
              下のボタンは検索窓に入れる言葉の例です。迷ったらテーマ名、議員名、市町村名のどれかから始めてください。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "子育て支援", href: "/search?q=%E5%AD%90%E8%82%B2%E3%81%A6%E6%94%AF%E6%8F%B4" },
              { label: "除雪", href: "/search?q=%E9%99%A4%E9%9B%AA" },
              { label: "防災", href: "/search?q=%E9%98%B2%E7%81%BD" },
              { label: "ラピダス", href: "/search?q=%E3%83%A9%E3%83%94%E3%83%80%E3%82%B9" },
              { label: "議決結果", href: "/search?q=%E8%AD%B0%E6%B1%BA&source=decision" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="inline-flex items-center rounded-full border border-[#D8DEE8] bg-[#F8FAFC] px-3 py-1.5 text-sm font-bold text-[#1B3A6B] transition-colors hover:border-[#1B3A6B] hover:bg-[#E8EEF7]"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {topTags.length > 0 && (
          <div className="mt-4 border-t border-[#E2E8F0] pt-4">
            <p className="mb-2 text-sm font-bold text-[#475569]">テーマ別入口</p>
            <p className="mb-2 text-sm leading-relaxed text-[#64748B]">
              よく出るテーマを先にまとめた入口です。詳しく絞るときは、このページの検索窓に戻れます。
            </p>
            <div className="flex flex-wrap gap-2">
              {topTags.map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/topics/${encodeURIComponent(tag)}`}
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

      <SearchClient />
    </div>
  );
}
