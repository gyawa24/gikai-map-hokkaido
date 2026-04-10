import fs from "fs";
import path from "path";
import SearchClient from "@/components/SearchClient";

export const metadata = { title: "検索 | 北海道議会情報マップ" };

function loadSearchIndex() {
  const dataRoot = path.join(process.cwd(), "data");

  // セッションデータ
  const sessions: SearchSession[] = [];
  for (const city of ["chitose"]) {
    const indexPath = path.join(dataRoot, city, "sessions", "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    for (const entry of index) {
      if (!entry.has_summary || entry.segment_count === 0) continue;
      const fp = path.join(dataRoot, city, "sessions", `${entry.id}.json`);
      if (!fs.existsSync(fp)) continue;
      const s = JSON.parse(fs.readFileSync(fp, "utf-8"));
      sessions.push({
        id: s.id,
        city,
        title: s.title,
        date: s.date,
        committee: s.committee ?? "",
        href: `/${city}/sessions/${s.id}`,
        segments: (s.segments ?? []).map((seg: any) => ({
          index: seg.index,
          label: seg.label,
          start_time: seg.start_time ?? "",
          summary: seg.summary ?? "",
          topics: seg.topics ?? [],
          transcript: seg.transcript ?? "",
        })),
      });
    }
  }

  // 議員データ
  const members: SearchMember[] = [];
  const cityNames: Record<string, string> = { chitose: "千歳市", eniwa: "恵庭市", tomakomai: "苫小牧市" };
  for (const city of ["chitose", "eniwa", "tomakomai"]) {
    const fp = path.join(dataRoot, city, "members.json");
    if (!fs.existsSync(fp)) continue;
    const list = JSON.parse(fs.readFileSync(fp, "utf-8"));
    for (const m of list) {
      members.push({
        city,
        cityName: cityNames[city],
        href: `/${city}`,
        name: m.name ?? "",
        furigana: m.furigana ?? "",
        party: m.party ?? "",
        faction: m.faction ?? "",
        committees: m.committees ?? [],
        votes: m.votes,
      });
    }
  }

  return { sessions, members };
}

export type SearchSession = {
  id: string; city: string; title: string; date: string; committee: string; href: string;
  segments: { index: number; label: string; start_time: string; summary: string; topics: string[]; transcript: string }[];
};
export type SearchMember = {
  city: string; cityName: string; href: string;
  name: string; furigana: string; party: string; faction: string; committees: string[]; votes?: number;
};

export default function SearchPage() {
  const { sessions, members } = loadSearchIndex();
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-[#1B3A6B] mb-5">検索</h2>
      <SearchClient sessions={sessions} members={members} />
    </div>
  );
}
