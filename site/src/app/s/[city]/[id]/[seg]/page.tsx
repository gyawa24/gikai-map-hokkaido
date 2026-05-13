// 発言単位の OG カード用 短縮ルート。
// 目的: SNS でシェアした時に seg ごとの OG 画像が出るようにする。
// 動作: サーバーが HTML + seg 別 Metadata を返し、ブラウザは JS で即 canonical
//       (/{city}/sessions/{id}#seg-{seg}) に replace する。クローラー(JSなし)
//       は Metadata の og:image を読み取るので、発言単位のカードが貼られる。
import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { Session, SessionSummary } from "@/types/session";
import { getMunicipality, getMunicipalities } from "@/lib/municipalities";

export const dynamicParams = false;

function getSession(city: string, id: string): Session | null {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "data", city, "sessions", `${id}.json`),
        "utf-8"
      )
    ) as Session;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function generateStaticParams() {
  const params: { city: string; id: string; seg: string }[] = [];
  for (const m of getMunicipalities()) {
    if (!m.active) continue;
    const indexPath = path.join(
      process.cwd(),
      "data",
      m.slug,
      "sessions",
      "index.json"
    );
    if (!fs.existsSync(indexPath)) continue;
    try {
      const index = JSON.parse(
        fs.readFileSync(indexPath, "utf-8")
      ) as SessionSummary[];
      for (const s of index) {
        const session = getSession(m.slug, s.id);
        if (!session) continue;
        for (const seg of session.segments ?? []) {
          params.push({ city: m.slug, id: s.id, seg: String(seg.index) });
        }
      }
    } catch {
      // skip
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string; seg: string }>;
}): Promise<Metadata> {
  const { city, id, seg } = await params;
  const segNum = Number(seg);
  const session = getSession(city, id);
  const segment = session?.segments.find((s) => s.index === segNum);
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  if (!session || !segment) {
    return { title: `発言 - ${cityName}議会` };
  }

  const detail = segment.detail;
  const speaker = detail?.speaker ?? segment.label;
  const overview = detail?.overview ?? segment.summary ?? "";
  const title = `${speaker} - ${session.title}（${formatDate(session.date)}） | ${cityName}議会`;
  const description = overview.slice(0, 100);
  const ogImage = `/api/og-segment?city=${city}&session=${id}&seg=${segNum}`;

  return {
    title,
    description,
    alternates: {
      canonical: `/${city}/sessions/${id}`,
    },
    openGraph: {
      title,
      description,
      url: `/s/${city}/${id}/${seg}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    robots: {
      index: false,
      follow: true,
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function ShortShareRedirect({
  params,
}: {
  params: Promise<{ city: string; id: string; seg: string }>;
}) {
  const { city, id, seg } = await params;
  const segNum = Number(seg);
  const session = getSession(city, id);
  if (!session) notFound();
  const segment = session.segments.find((s) => s.index === segNum);
  if (!segment) notFound();

  const canonical = `/${city}/sessions/${id}#seg-${seg}`;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const speaker = segment.detail?.speaker ?? segment.label;

  return (
    <>
      {/* JS ありの普通のブラウザは即リダイレクト。クローラー・JS無効は下の画面。 */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{location.replace(${JSON.stringify(canonical)});}catch(e){}})();`,
        }}
      />
      <div className="max-w-xl mx-auto text-center py-16 px-4">
        <p className="text-sm text-[#718096] mb-2">発言ページへ移動中…</p>
        <h1 className="text-lg font-bold text-[#1B3A6B] mb-1">
          {cityName}議会 / {session.title}
        </h1>
        <p className="text-sm text-[#4A5568] mb-6">
          {segment.label} - {speaker}
        </p>
        <Link
          href={canonical}
          className="inline-block px-5 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#2A5298] transition-colors"
        >
          該当発言を開く
        </Link>
      </div>
    </>
  );
}
