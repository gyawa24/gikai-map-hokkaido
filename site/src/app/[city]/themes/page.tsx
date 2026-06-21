import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { Member, MemberActivity } from "@/types/member";
import CityThemesClient, { type CityThemeMemberRow } from "@/components/CityThemesClient";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { withPublicMemberPhotoUrls } from "@/lib/memberPhotos";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getCapabilityCityStaticParams } from "@/lib/staticCityParams";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCapabilityCityStaticParams("themes");
}

// ---------- Data helpers ----------

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "members.json");
    return withPublicMemberPhotoUrls(
      JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")) as Member[]
    );
  } catch {
    return [];
  }
}

function getMemberActivity(city: string): Record<string, MemberActivity> | null {
  try {
    const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "members_activity.json");
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return null;
  }
}

// ---------- Metadata ----------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "themes")) notFound();

  const name = municipality?.council_name ?? "市町村議会";
  const title = `テーマ別議員 - ${name}`;
  return buildPageMetadata({
    title,
    description: `${name}の議員を政策テーマ別にランキング表示します。気になるテーマを選んで、相談できる議員を探しましょう。`,
    path: `/${city}/themes`,
  });
}

// ---------- Page ----------

export default async function CityThemesPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "themes")) notFound();

  const members = getMembers(city);
  const activity = getMemberActivity(city) ?? {};

  // Build member lookup by stripped name
  const activityMap = new Map(Object.entries(activity));

  // Collect all themes with member counts
  const themeCount = new Map<string, number>();
  for (const act of Object.values(activity)) {
    for (const t of act.themes ?? []) {
      themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
    }
  }

  const rows: CityThemeMemberRow[] = members.map((member) => {
    const key = member.name.replace(/\s/g, "");
    const act = activityMap.get(key);

    return {
      name: member.name,
      seat_number: member.seat_number,
      faction: member.faction ?? "",
      photo_url: member.photo_url,
      session_count: act?.session_count ?? 0,
      summary_topics: act?.summary_topics ?? [],
      top_topics: act?.top_topics ?? [],
      themes: act?.themes ?? [],
    };
  });

  // Sort themes by member count descending, then alphabetically
  const allThemes = Array.from(themeCount.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .map(([t]) => t);
  const themeCounts = Object.fromEntries(themeCount);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">テーマ別議員</span>
      </nav>

      {/* ページ見出し */}
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">テーマ別議員ランキング</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          テーマを選ぶと、そのテーマで活発に活動している議員を発言回数の多い順に表示します。
        </p>
      </section>

      <Suspense
        fallback={
          <div className="rounded-lg border border-[#CBD5E0] bg-white p-8 text-center text-[#718096]">
            テーマ別の一覧を読み込んでいます。
          </div>
        }
      >
        <CityThemesClient city={city} rows={rows} allThemes={allThemes} themeCounts={themeCounts} />
      </Suspense>

      {/* 利用案内 */}
      <section className="mt-10 bg-[#E8EEF7] rounded-lg border border-[#C5D0E6] p-6">
        <h3 className="text-base font-bold text-[#1B3A6B] mb-2">この問題は誰に相談すれば？</h3>
        <p className="text-base text-[#4A5568] leading-relaxed mb-3">
          地域の問題や市政への要望がある場合、テーマに関心を持つ議員に相談するのが近道です。
          上のテーマから気になる分野を選び、発言実績の多い議員を探してみましょう。
        </p>
        <ul className="space-y-1.5 text-sm text-[#4A5568]">
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>発言回数は過去の定例会・委員会での質問登壇数をもとにしています。</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>「議員詳細」から過去の質問内容や議事録全文を確認できます。</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>
              <Link
                href="/search"
                className="text-[#2A5298] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              >
                議事録検索
              </Link>
              を使うと、テーマに関する議会での議論を横断的に調べることもできます。
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
