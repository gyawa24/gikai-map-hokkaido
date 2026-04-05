import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Decision } from "@/types/decision";

export const metadata: Metadata = {
  title: "議決結果 | 北海道議会情報マップ - 千歳市",
};

function getDecisions(): Decision[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "chitose",
    "decisions.json"
  );
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Decision[];
}

/** description 内の「(XX月)」または「(XX月)」を抽出する */
function extractPeriod(description: string): string {
  const m = description.match(/（(.{1,4}月)）|\((.{1,4}月)\)/);
  if (m) return m[1] ?? m[2];
  return "";
}

/** PDFタイトルからファイルサイズ部分を除去して短くする */
function shortTitle(title: string): string {
  return title.replace(/\s*（PDF.+?）/, "").replace(/\s*\(PDF.+?\)/, "").trim();
}

export default function DecisionsPage() {
  const decisions = getDecisions();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800">議決結果</h2>
        <p className="text-sm text-gray-500 mt-1">
          直近4回の定例会の議決結果PDFを掲載しています。
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {decisions.map((d) => {
          const period = extractPeriod(d.description);
          return (
            <div
              key={d.session}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-6"
            >
              {/* セッションヘッダー */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h3 className="text-base font-bold text-gray-900">
                  {d.session}
                </h3>
                {period && (
                  <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-0.5 font-medium">
                    {period}
                  </span>
                )}
              </div>

              {/* PDFリンク */}
              <div className="flex flex-wrap gap-3">
                {d.pdf_links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-white bg-[#1a3a6c] hover:bg-[#254d8f] rounded-lg px-4 py-2 transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    {shortTitle(link.title)}
                  </a>
                ))}

                {/* 公式ページリンク */}
                <a
                  href={d.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-4 py-2 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-3.5 h-3.5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  公式ページ
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
