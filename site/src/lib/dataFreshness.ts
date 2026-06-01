import fs from "node:fs";
import path from "node:path";

/**
 * build 時に生成される search index の generated_at を「データ最終更新日」として
 * サイトで表示するためのユーティリティ。
 * 更新: data/ の内容が変わる → git push → build/prebuild で
 * search-index.json 再生成 → generated_at が更新される、という連鎖で自動追随する。
 */
export function getSearchIndexGeneratedAt(): Date | null {
  try {
    const fp = path.join(process.cwd(), "data", "_search-index.json");
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
      generated_at?: string;
    };
    if (!data.generated_at) return null;
    return new Date(data.generated_at);
  } catch {
    return null;
  }
}

export function formatJaDate(d: Date | null | undefined): string {
  if (!d) return "";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
