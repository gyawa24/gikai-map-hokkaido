import { Suspense } from "react";
import { getMunicipalities } from "@/lib/municipalities";
import { getAllTags } from "@/lib/topics";
import AISearchClient from "./client";

export const metadata = {
  title: "AI検索 - 北海道議会情報マップ",
  description: "北海道内の市町村議会の議事録をAIで横断検索・比較できます。",
};

export default function AISearchPage() {
  const allMunis = getMunicipalities().filter(
    (m) => m.active && m.level === "municipality" && m.features.includes("minutes")
  );
  const cities = allMunis.map((m) => ({
    slug: m.slug,
    name: m.name,
    region: m.region,
  }));

  const tags = getAllTags()
    .slice(0, 20)
    .map((t) => t.tag);

  return (
    <Suspense>
      <AISearchClient cities={cities} themes={tags} />
    </Suspense>
  );
}
