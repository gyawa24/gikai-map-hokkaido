import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { buildPageMetadata, absoluteUrl, SITE_NAME } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";
import {
  articleCategoryClass,
  formatArticleDate,
  getArticle,
  getArticles,
} from "@/lib/articles";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getArticles().map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) {
    return buildPageMetadata({
      title: "記事",
      path: "/articles",
    });
  }

  return buildPageMetadata({
    title: article.title,
    description: article.summary,
    path: `/articles/${article.slug}`,
    type: "article",
  });
}

export default async function ArticleDetailPage({ params }: Props) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const path = `/articles/${article.slug}`;
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: "読みもの", path: "/articles" },
    { name: article.title, path },
  ]);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: article.date,
    dateModified: article.date,
    author: {
      "@type": "Organization",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    mainEntityOfPage: absoluteUrl(path),
    inLanguage: "ja-JP",
  };

  return (
    <article className="mx-auto max-w-3xl">
      <JsonLd data={[breadcrumb, articleJsonLd]} />
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-[#718096]">
        <Link href="/articles" className="transition-colors hover:text-[#1B3A6B]">
          読みもの
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">記事</span>
      </nav>

      <header className="mb-8 rounded-[24px] border border-[#CBD5E0] bg-white px-5 py-6 shadow-sm sm:px-7">
        <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          {article.title}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[#4A5568]">
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
      </header>

      <div className="space-y-8 rounded-[24px] border border-[#CBD5E0] bg-white px-5 py-6 shadow-sm sm:px-7">
        {article.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="border-b border-[#E2E8F0] pb-2 text-xl font-bold text-[#1B3A6B]">
              {section.heading}
            </h2>
            <div className="mt-4 space-y-4">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-base leading-relaxed text-[#1A202C]">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-8 border-t border-[#E2E8F0] pt-4">
        <Link href="/articles" className="text-sm font-medium text-[#2A5298] hover:text-[#1B3A6B]">
          読みもの一覧へ戻る
        </Link>
      </footer>
    </article>
  );
}
