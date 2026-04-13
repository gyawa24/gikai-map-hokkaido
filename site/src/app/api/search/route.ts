import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { MinutesIndexItem, MinutesSession } from "@/types/minutes";

const CITY_NAMES: Record<string, string> = {
  chitose: "千歳市",
  eniwa: "恵庭市",
  tomakomai: "苫小牧市",
  asahikawa: "旭川市",
  ashibetsu: "芦別市",
  date: "伊達市",
  hakodate: "函館市",
  ishikari: "石狩市",
  kitahiroshima: "北広島市",
  kitami: "北見市",
  kushiro: "釧路市",
  muroran: "室蘭市",
  nayoro: "名寄市",
  nemuro: "根室市",
  obihiro: "帯広市",
  wakkanai: "稚内市",
};

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function matchesAll(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t.toLowerCase()));
}

function excerpt(text: string, tokens: string[], radius = 60): string {
  const first = tokens[0] ?? "";
  const idx = text.toLowerCase().indexOf(first.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + first.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export type SessionHit = {
  id: string;
  city: string;
  cityName: string;
  sourceType: "session" | "minutes" | "decision";
  title: string;
  committee: string;
  href: string;
  segIndex: number;
  label: string;
  startTime: string;
  context: string;
  field: string;
};

export type MemberHit = {
  city: string;
  cityName: string;
  href: string;
  name: string;
  furigana: string;
  party: string;
  faction: string;
  committees: string[];
};

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const tokens = tokenize(q);

  if (!tokens.length) {
    return NextResponse.json({ sessionResults: [], memberResults: [] });
  }

  const dataRoot = path.join(process.cwd(), "data");
  const sessionResults: SessionHit[] = [];

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
      const committee = s.committee ?? "";
      const cityName = CITY_NAMES[city];
      let pushed = false;
      for (const seg of (s.segments ?? [])) {
        const fields = [
          { text: seg.summary ?? "", field: "要約" },
          { text: (seg.topics ?? []).join(" "), field: "トピック" },
          { text: seg.transcript ?? "", field: "全文" },
        ];
        for (const { text, field } of fields) {
          if (matchesAll(text, tokens)) {
            sessionResults.push({
              id: s.id,
              city,
              cityName,
              sourceType: "session",
              title: s.title,
              committee,
              href: `/${city}/sessions/${s.id}`,
              segIndex: seg.index,
              label: seg.label,
              startTime: seg.start_time ?? "",
              context: excerpt(text, tokens),
              field,
            });
            pushed = true;
            break;
          }
        }
        if (pushed) break;
      }
      if (!pushed && matchesAll(s.title + committee, tokens)) {
        sessionResults.push({
          id: s.id,
          city,
          cityName,
          sourceType: "session",
          title: s.title,
          committee,
          href: `/${city}/sessions/${s.id}`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: committee,
          field: "会議名",
        });
      }
    }
  }

  // 公式議事録（minutes/index.json がある全市）
  const seenMinutes = new Set<string>();
  for (const city of Object.keys(CITY_NAMES)) {
    const indexPath = path.join(dataRoot, city, "minutes", "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as MinutesIndexItem[];
    for (const entry of index) {
      const fp = path.join(dataRoot, city, "minutes", entry.file);
      if (!fs.existsSync(fp)) continue;
      const s = JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesSession;
      const committee = entry.type_label.split(">").pop()?.trim() ?? "";
      const cityName = CITY_NAMES[city];
      const minuteKey = `${city}_${s.council_id}`;
      let pushed = false;
      for (let i = 0; i < s.schedules.length; i++) {
        const sch = s.schedules[i];
        const text = sch.minutes
          .filter((m) => m.minute_type !== "名簿")
          .map((m) => `${m.title} ${m.text}`)
          .join("\n");
        if (matchesAll(text, tokens)) {
          sessionResults.push({
            id: `${city}_minutes_${s.council_id}`,
            city,
            cityName,
            sourceType: "minutes",
            title: s.name,
            committee,
            href: `/${city}/minutes/${s.council_id}`,
            segIndex: i,
            label: sch.name,
            startTime: "",
            context: excerpt(text, tokens),
            field: "議事録",
          });
          seenMinutes.add(minuteKey);
          pushed = true;
          break;
        }
      }
      if (!pushed && matchesAll(s.name + committee, tokens)) {
        sessionResults.push({
          id: `${city}_minutes_${s.council_id}`,
          city,
          cityName,
          sourceType: "minutes",
          title: s.name,
          committee,
          href: `/${city}/minutes/${s.council_id}`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: committee,
          field: "会議名",
        });
        seenMinutes.add(minuteKey);
      }
    }
  }

  // 公式議事録（enriched JSONのみの市 — minutes/index.json がない全市）
  interface EnrichedDoc {
    council_id: number;
    name: string;
    summary?: string;
    highlights?: string[];
    tags?: string[];
  }
  for (const city of Object.keys(CITY_NAMES)) {
    const enrichedDir = path.join(dataRoot, city, "minutes", "enriched");
    if (!fs.existsSync(enrichedDir)) continue;
    const cityName = CITY_NAMES[city];
    let files: string[];
    try { files = fs.readdirSync(enrichedDir).filter((f) => f.endsWith(".json")); }
    catch { continue; }
    for (const file of files) {
      const fp = path.join(enrichedDir, file);
      let doc: EnrichedDoc;
      try { doc = JSON.parse(fs.readFileSync(fp, "utf-8")) as EnrichedDoc; }
      catch { continue; }
      const minuteKey = `${city}_${doc.council_id}`;
      if (seenMinutes.has(minuteKey)) continue; // full-text 検索済みはスキップ
      const searchText = [
        doc.name,
        doc.summary ?? "",
        ...(doc.highlights ?? []),
        ...(doc.tags ?? []),
      ].join(" ");
      if (!matchesAll(searchText, tokens)) continue;
      const contextText = doc.summary
        ? excerpt(doc.summary, tokens, 120)
        : (doc.highlights ?? []).slice(0, 2).join("、");
      sessionResults.push({
        id: `${city}_minutes_${doc.council_id}`,
        city,
        cityName,
        sourceType: "minutes",
        title: doc.name,
        committee: "",
        href: `/${city}/minutes/${doc.council_id}`,
        segIndex: 0,
        label: "",
        startTime: "",
        context: contextText,
        field: "AI要約",
      });
      seenMinutes.add(minuteKey);
    }
  }

  // 議決結果（3市）
  const decisionHrefs: Record<string, string> = {
    chitose: "/chitose",
    eniwa: "/eniwa/decisions",
    tomakomai: "/tomakomai/decisions",
  };
  for (const city of ["chitose", "eniwa", "tomakomai"]) {
    const decisionsPath = path.join(dataRoot, city, "decisions.json");
    if (!fs.existsSync(decisionsPath)) continue;
    const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf-8")) as Array<{
      session: string;
      source_url: string;
      description?: string;
    }>;
    const cityName = CITY_NAMES[city];
    for (const d of decisions) {
      const text = [d.session, d.description ?? ""].join(" ");
      if (matchesAll(text, tokens)) {
        sessionResults.push({
          id: `${city}_decision_${d.session}`,
          city,
          cityName,
          sourceType: "decision",
          title: d.session,
          committee: "議決結果",
          href: decisionHrefs[city] ?? `/${city}`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: excerpt(text, tokens),
          field: "議決",
        });
      }
    }
  }

  // 議員検索
  const memberResults: MemberHit[] = [];
  for (const city of ["chitose", "eniwa", "tomakomai"]) {
    const membersPath = path.join(dataRoot, city, "members.json");
    const cityName = CITY_NAMES[city];
    if (fs.existsSync(membersPath)) {
      const list = JSON.parse(fs.readFileSync(membersPath, "utf-8"));
      for (const m of list) {
        if (matchesAll([m.name ?? "", m.furigana ?? "", m.party ?? "", m.faction ?? "", ...(m.committees ?? [])].join(" "), tokens)) {
          memberResults.push({
            city, cityName,
            href: `/${city}`,
            name: m.name ?? "",
            furigana: m.furigana ?? "",
            party: m.party ?? "",
            faction: m.faction ?? "",
            committees: m.committees ?? [],
          });
        }
      }
    } else {
      const electionPath = path.join(dataRoot, city, "election.json");
      if (!fs.existsSync(electionPath)) continue;
      const data = JSON.parse(fs.readFileSync(electionPath, "utf-8"));
      for (const c of (data.candidates ?? []).filter((c: { result: string }) => c.result === "当選")) {
        if (matchesAll([c.name ?? "", c.furigana ?? "", c.party ?? ""].join(" "), tokens)) {
          memberResults.push({
            city, cityName,
            href: `/${city}`,
            name: c.name ?? "",
            furigana: c.furigana ?? "",
            party: c.party ?? "",
            faction: c.party ?? "",
            committees: [],
          });
        }
      }
    }
  }

  return NextResponse.json({ sessionResults, memberResults });
}
