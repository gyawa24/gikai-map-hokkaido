import Link from "next/link";
import { aliasesForTag, canonicalizeTag, isCitizenTopic, slugForTag, tagFromSlug } from "@/lib/topicAliases";
import AIDisclaimer from "@/components/AIDisclaimer";
import TopicRecordsClient from "@/components/TopicRecordsClient";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

type Props = {
  params: Promise<{ tag: string }>;
};

function decodeTagParam(tag: string) {
  try {
    return tagFromSlug(decodeURIComponent(tag));
  } catch {
    return tagFromSlug(tag);
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const decoded = decodeTagParam(tag);
  const canonical = canonicalizeTag(decoded);
  const metadata = buildPageMetadata({
    title: `${canonical} - テーマ別議事録`,
    description: `北海道内の市町村議会で「${canonical}」に関連する議事録の一覧です。自治体を横断して確認できます。`,
    path: `/topics/${slugForTag(canonical)}`,
  });
  return isCitizenTopic(canonical)
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

export const dynamicParams = true;
export const dynamic = "force-dynamic";

export default async function TopicTagPage({ params }: Props) {
  const { tag } = await params;
  const decoded = decodeTagParam(tag);
  const canonical = canonicalizeTag(decoded);
  const aliases = aliasesForTag(canonical).filter((alias) => alias !== canonical);
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: "テーマ別議事録", path: "/topics" },
    { name: canonical, path: `/topics/${slugForTag(canonical)}` },
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
          <h1 className="text-xl font-bold text-[#1B3A6B]">{canonical}</h1>
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
      <TopicRecordsClient canonical={canonical} />
    </div>
  );
}
