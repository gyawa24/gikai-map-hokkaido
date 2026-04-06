import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Decision } from "@/types/decision";

export const metadata: Metadata = {
  title: "議決結果 | 北海道議会情報マップ - 苫小牧市",
};

function getDecisions(): Decision[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "tomakomai",
    "decisions.json"
  );
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Decision[];
}

function shortTitle(title: string): string {
  return title.replace(/\s*（PDF.+?）/, "").replace(/\s*\(PDF.+?\)/, "").trim();
}

export default function TomakomaiDecisionsPage() {
  const decisions = getDecisions();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800">議決結果</h2>
        <p className="text-sm text-gray-500 mt-1">
          令和6〜7年の定例会議決結果PDFを掲載しています。
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {decisions.map((d) => (
          <div
            key={d.session}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-6"
          >
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="text-base font-bold text-gray-900">{d.session}</h3>
            </div>

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
        ))}
      </div>
    </div>
  );
}
