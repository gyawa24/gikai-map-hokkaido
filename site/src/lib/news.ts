import fs from "node:fs";
import path from "node:path";

export type NewsCategory =
  | "機能追加"
  | "改善"
  | "修正"
  | "お知らせ"
  | "自治体追加";

export type NewsItem = {
  date: string;
  category: NewsCategory;
  title: string;
  body: string;
};

/**
 * data/news.json を読み、日付降順で返す。
 * 読めない・形式が不正な場合は空配列。
 */
export function getNews(): NewsItem[] {
  try {
    const fp = path.join(process.cwd(), "data", "news.json");
    const arr = JSON.parse(fs.readFileSync(fp, "utf-8")) as NewsItem[];
    if (!Array.isArray(arr)) return [];
    return [...arr].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  } catch {
    return [];
  }
}

const CATEGORY_STYLES: Record<NewsCategory, string> = {
  機能追加: "bg-[#E8EEF7] text-[#2A5298] border border-[#C5D0E6]",
  改善: "bg-[#F0FFF4] text-[#276749] border border-[#C6F6D5]",
  修正: "bg-[#FFF7E6] text-[#78451F] border border-[#F7C948]",
  お知らせ: "bg-[#F4F6F9] text-[#4A5568] border border-[#E2E8F0]",
  自治体追加: "bg-[#F3E8FF] text-[#6B21A8] border border-[#E9D5FF]",
};

export function categoryClass(cat: NewsCategory): string {
  return CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.お知らせ;
}
