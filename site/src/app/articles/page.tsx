import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import {
  articleCategoryClass,
  formatArticleDate,
  getArticles,
} from "@/lib/articles";

export const metadata = buildPageMetadata({
  title: "読みもの",
  description:
    "地方議会ドットコムの読みもの。議会質問の背景、議員インタビュー、議事録の読みどころを市民向けに紹介します。",
  path: "/articles",
});

export default function ArticlesPage() {
  const articles = getArticles();

  return (
    <div className="page-shell max-w-5xl">
      <header className="mb-7">
        <p className="portal-subhead mb-3">読みもの</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          議会質問の背景を読む
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-[#4A5568]">
          いい質問をした議員へのインタビュー、質問の意図、議事録の読みどころを紹介します。
          記事から原典に戻れる、地方議会ドットコムらしい読みものを育てていきます。
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-8 text-center text-[#718096]">
          まだ記事はありません。
        </div>
      ) : (
        <div className="grid gap-4">
          {articles.map((article) => (
            <Link
              key={article.slug}
              href={`/articles/${article.slug}`}
              className="rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm transition-all duration-150 hover:border-[#1B3A6B] hover:shadow-md"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${articleCategoryClass(
                    article.category
                  )}`}
                >
                  {article.category}
                </span>
                <time dateTime={article.date} className="text-xs text-[#718096]">
                  {formatArticleDate(article.date)}
                </time>
                <span className="text-xs text-[#718096]">{article.readingMinutes}分で読めます</span>
              </div>

              <h2 className="text-lg font-bold leading-snug text-[#1A202C] transition-colors hover:text-[#1B3A6B]">
                {article.title}
              </h2>
              <p className="mt-2 text-base leading-relaxed text-[#4A5568]">
                {article.summary}
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {article.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[#E2E8F0] bg-[#F4F6F9] px-2 py-0.5 text-xs text-[#4A5568]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
