import fs from "fs";
import path from "path";
import SearchClient from "@/components/SearchClient";
import type { MinutesIndexItem, MinutesSession } from "@/types/minutes";

export const metadata = { title: "検索 | 北海道議会情報マップ" };

const CITY_NAMES: Record<string, string> = {
  chitose: "千歳市",
  eniwa: "恵庭市",
  tomakomai: "苫小牧市",
};

function loadSearchIndex() {
  const dataRoot = path.join(process.cwd(), "data");

  const sessions: SearchSession[] = [];

  // YouTube会議録（千歳のみ）
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
        cityName: CITY_NAMES[city],
        sourceType: "session",
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

  // 公式議事録（3市）
  for (const city of ["chitose", "eniwa", "tomakomai"]) {
    const indexPath = path.join(dataRoot, city, "minutes", "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as MinutesIndexItem[];
    for (const entry of index) {
      const fp = path.join(dataRoot, city, "minutes", entry.file);
      if (!fs.existsSync(fp)) continue;
      const s = JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesSession;
      const committee = entry.type_label.split(">").pop()?.trim() ?? "";
      sessions.push({
        id: `${city}_minutes_${s.council_id}`,
        city,
        cityName: CITY_NAMES[city],
        sourceType: "minutes",
        title: s.name,
        date: `${entry.year}-01-01`,
        committee,
        href: `/${city}/minutes/${s.council_id}`,
        segments: s.schedules.map((sch, i) => ({
          index: i,
          label: sch.name,
          start_time: "",
          summary: "",
          topics: [],
          transcript: sch.minutes
            .filter((m) => m.minute_type !== "名簿")
            .map((m) => `${m.title} ${m.text}`)
            .join("\n"),
        })),
      });
    }
  }

  // 議員データ（members.json優先、なければelection.jsonの当選者）
  const members: SearchMember[] = [];
  for (const city of ["chitose", "eniwa", "tomakomai"]) {
    const membersPath = path.join(dataRoot, city, "members.json");
    if (fs.existsSync(membersPath)) {
      const list = JSON.parse(fs.readFileSync(membersPath, "utf-8"));
      for (const m of list) {
        members.push({
          city,
          cityName: CITY_NAMES[city],
          href: `/${city}`,
          name: m.name ?? "",
          furigana: m.furigana ?? "",
          party: m.party ?? "",
          faction: m.faction ?? "",
          committees: m.committees ?? [],
          votes: m.votes,
        });
      }
    } else {
      const electionPath = path.join(dataRoot, city, "election.json");
      if (!fs.existsSync(electionPath)) continue;
      const data = JSON.parse(fs.readFileSync(electionPath, "utf-8"));
      for (const c of (data.candidates ?? []).filter((c: any) => c.result === "当選")) {
        members.push({
          city,
          cityName: CITY_NAMES[city],
          href: `/${city}`,
          name: c.name ?? "",
          furigana: c.furigana ?? "",
          party: c.party ?? "",
          faction: c.party ?? "",
          committees: [],
          votes: c.votes,
        });
      }
    }
  }

  return { sessions, members };
}

export type SearchSession = {
  id: string;
  city: string;
  cityName: string;
  sourceType: "session" | "minutes";
  title: string;
  date: string;
  committee: string;
  href: string;
  segments: {
    index: number;
    label: string;
    start_time: string;
    summary: string;
    topics: string[];
    transcript: string;
  }[];
};

export type SearchMember = {
  city: string;
  cityName: string;
  href: string;
  name: string;
  furigana: string;
  party: string;
  faction: string;
  committees: string[];
  votes?: number;
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
