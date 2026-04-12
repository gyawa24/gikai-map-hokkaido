import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Newsletter } from "@/types/newsletter";

export const metadata: Metadata = {
  title: "議会だより | 北海道議会情報マップ - 千歳市",
};

function getNewsletter(): Newsletter | null {
  const filePath = path.join(
    process.cwd(),
    "data",
    "chitose",
    "newsletter.json"
  );
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Newsletter;
  } catch {
    return null;
  }
}

/** "ちとせ市議会だよりNo.210 （PDF 2.0 MB）" → { label: "No.210", size: "2.0 MB" } */
function parsePdfTitle(title: string): { label: string; size: string } {
  const labelMatch = title.match(/(No\.\d+)/);
  const sizeMatch = title.match(/PDF\s*([\d.]+\s*[KMG]B)/i);
  return {
    label: labelMatch ? labelMatch[1] : title,
    size: sizeMatch ? sizeMatch[1] : "",
  };
}

/** "市議会だより第210号～最新号～(令和7年第4回定例会)" → 号数と定例会を分離 */
function parseTitle(title: string): { number: string; session: string } {
  const numMatch = title.match(/第(\d+)号/);
  const sessionMatch = title.match(/[（(](.+?)[）)]/);
  return {
    number: numMatch ? `第${numMatch[1]}号` : "",
    session: sessionMatch ? sessionMatch[1] : "",
  };
}

export default function NewsletterPage() {
  const nl = getNewsletter();

  if (!nl) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-800">議会だより</h2>
          <p className="text-sm text-gray-500 mt-1">
            千歳市議会だよりの最新号を掲載しています。
          </p>
        </div>
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている議会だよりはありません。
        </div>
      </div>
    );
  }

  const { number, session } = parseTitle(nl.title);
  const { label: pdfLabel, size: pdfSize } = parsePdfTitle(nl.pdf_title);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800">議会だより</h2>
        <p className="text-sm text-gray-500 mt-1">
          千歳市議会だよりの最新号を掲載しています。
        </p>
      </div>

      {/* 最新号カード */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 max-w-xl">
        {/* バッジ */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-semibold bg-blue-50 text-blue-700 rounded-full px-3 py-0.5">
            最新号
          </span>
          {session && (
            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-3 py-0.5">
              {session}
            </span>
          )}
        </div>

        {/* タイトル */}
        <h3 className="text-xl font-bold text-gray-900 mb-1">
          ちとせ市議会だより{number}
        </h3>
        <p className="text-sm text-gray-400 mb-6">
          発行: {nl.published_date}
        </p>

        {/* PDFダウンロード */}
        <div className="flex flex-wrap gap-3">
          <a
            href={nl.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-[#1a3a6c] hover:bg-[#254d8f] rounded-lg px-5 py-2.5 transition-colors"
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
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            {pdfLabel} をダウンロード
            {pdfSize && (
              <span className="text-blue-200 text-xs">{pdfSize}</span>
            )}
          </a>

          <a
            href={nl.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-4 py-2.5 transition-colors"
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
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            公式ページ
          </a>
        </div>
      </div>
    </div>
  );
}
