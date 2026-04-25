import Link from "next/link";
import { getNews, categoryClass } from "@/lib/news";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "お知らせ・更新情報",
  description:
    "地方議会ドットコムの新機能・改善・自治体追加などのお知らせを時系列でご覧いただけます。",
  path: "/news",
});

function formatDateJa(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

export default function NewsPage() {
  const items = getNews();

  return (
    <article className="max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[#1B3A6B] mb-2">お知らせ・更新情報</h1>
        <p className="text-sm text-[#718096]">
          新機能の追加、改善、自治体の追加などを時系列でお伝えします。
        </p>
      </header>

      {items.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          まだお知らせはありません。
        </div>
      ) : (
        <ol className="relative border-l-2 border-[#CBD5E0] pl-6 space-y-6">
          {items.map((item, i) => (
            <li key={i} className="relative">
              {/* タイムラインドット */}
              <span
                aria-hidden="true"
                className="absolute -left-[33px] top-1.5 w-4 h-4 rounded-full bg-white border-2 border-[#1B3A6B]"
              />
              <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${categoryClass(
                      item.category
                    )}`}
                  >
                    {item.category}
                  </span>
                  <time
                    dateTime={item.date}
                    className="text-xs text-[#718096]"
                  >
                    {formatDateJa(item.date)}
                  </time>
                </div>
                <h2 className="text-base font-bold text-[#1A202C] leading-snug mb-1.5">
                  {item.title}
                </h2>
                <p className="text-sm text-[#4A5568] leading-relaxed whitespace-pre-wrap">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <nav className="mt-10 pt-4 border-t border-[#E2E8F0] text-sm text-[#718096]">
        <Link href="/" className="text-[#2A5298] hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </article>
  );
}
