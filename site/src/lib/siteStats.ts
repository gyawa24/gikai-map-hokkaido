import fs from "node:fs";
import path from "node:path";
import { getMunicipalities } from "@/lib/municipalities";

export type SiteStats = {
  /** 対象自治体（active な市町村＋都道府県）の数 */
  municipalityCount: number;
  /** 議員（members.json 配列の合計） */
  memberCount: number;
  /** 会議録の council 数（minutes/index.json の合計 + 単独 minutes/*.json） */
  minutesCount: number;
  /** 議決件数（decisions.json 配列の合計） */
  decisionCount: number;
  /** 議題チャンク数（search index の agendas 長） */
  agendaCount: number;
};

function countJsonArray(fp: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

function countSearchIndex(dataRoot: string): number {
  try {
    const fp = path.join(dataRoot, "_search-index.json");
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
      agendas?: unknown[];
    };
    return Array.isArray(data.agendas) ? data.agendas.length : 0;
  } catch {
    return 0;
  }
}

export function getSiteStats(): SiteStats {
  const munis = getMunicipalities().filter((m) => m.active);
  const dataRoot = path.join(process.cwd(), "data");

  let memberCount = 0;
  let minutesCount = 0;
  let decisionCount = 0;

  for (const m of munis) {
    const cityDir = path.join(dataRoot, m.slug);
    memberCount += countJsonArray(path.join(cityDir, "members.json"));
    decisionCount += countJsonArray(path.join(cityDir, "decisions.json"));

    // 会議録は3形態ありうる: minutes/index.json / 直下 index.json / minutes/ 配下
    const idxA = path.join(cityDir, "minutes", "index.json");
    const idxB = path.join(cityDir, "index.json");
    if (fs.existsSync(idxA)) {
      minutesCount += countJsonArray(idxA);
    } else if (fs.existsSync(idxB)) {
      minutesCount += countJsonArray(idxB);
    }
  }

  return {
    municipalityCount: munis.length,
    memberCount,
    minutesCount,
    decisionCount,
    agendaCount: countSearchIndex(dataRoot),
  };
}
