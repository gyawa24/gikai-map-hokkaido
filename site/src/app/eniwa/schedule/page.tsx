import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { CitySchedule } from "@/types/citySchedule";

export const metadata: Metadata = {
  title: "行事予定 | 北海道議会情報マップ - 恵庭市",
};

function getSchedule(): CitySchedule | null {
  const filePath = path.join(process.cwd(), "data", "eniwa", "schedule.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CitySchedule;
  } catch {
    return null;
  }
}

export default function EniwaSchedulePage() {
  const schedule = getSchedule();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800">行事予定</h2>
        <p className="text-sm text-gray-500 mt-1">
          恵庭市議会の会議日程・行事予定です。
        </p>
      </div>

      {schedule === null ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在データを準備中です。
        </div>
      ) : (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 max-w-xl">
        <p className="text-sm text-gray-600 mb-5">{schedule.note}</p>

        <div className="flex flex-col gap-3">
          {schedule.pdf_schedules.length > 0 ? (
            schedule.pdf_schedules.map((item) => (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-[#1a3a6c] hover:text-[#254d8f] border border-[#1a3a6c] hover:bg-blue-50 rounded-lg px-4 py-2.5 transition-colors"
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
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="15" y2="17" />
                </svg>
                {item.label}
              </a>
            ))
          ) : (
            <p className="text-sm text-gray-400">現在、予定はありません。</p>
          )}

          <a
            href={schedule.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-4 py-2.5 transition-colors mt-2"
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
            恵庭市議会 公式サイト（会議日程）
          </a>
        </div>
      </div>
      )}
    </div>
  );
}
