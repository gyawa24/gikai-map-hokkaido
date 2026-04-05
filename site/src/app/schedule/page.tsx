import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { ScheduleEvent } from "@/types/schedule";

export const metadata: Metadata = {
  title: "行事予定 | 北海道議会情報マップ - 千歳市",
};

function getSchedule(): ScheduleEvent[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "chitose",
    "schedule.json"
  );
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ScheduleEvent[];
}

/** "14時00分...内容" の "..." を改行に変換して読みやすくする */
function formatContent(content: string): string[] {
  if (content === "予定なし") return [];
  return content.split("...").map((s) => s.trim()).filter(Boolean);
}

/** "３月30日 (月曜日)" → 曜日部分を取り出す */
function extractDayOfWeek(date: string): string {
  const m = date.match(/[（(](.+?)[）)]/);
  return m ? m[1] : "";
}

/** 曜日→背景色 */
function dayColor(dow: string): string {
  if (dow.startsWith("日")) return "text-red-500";
  if (dow.startsWith("土")) return "text-blue-500";
  return "text-gray-700";
}

export default function SchedulePage() {
  const events = getSchedule();

  // period_label でグループ化
  const groups = events.reduce<Record<string, ScheduleEvent[]>>((acc, ev) => {
    (acc[ev.period_label] ??= []).push(ev);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800">行事予定</h2>
        <p className="text-sm text-gray-500 mt-1">
          千歳市議会の直近の行事予定です。
        </p>
      </div>

      {Object.entries(groups).map(([label, groupEvents]) => (
        <div key={label} className="mb-6">
          {/* 期間ラベル */}
          <div className="text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5 mb-3 inline-block">
            {label}
          </div>

          {/* 日程テーブル */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {groupEvents.map((ev, i) => {
              const dow = extractDayOfWeek(ev.date);
              const lines = formatContent(ev.content);
              const hasEvent = lines.length > 0;
              const isLast = i === groupEvents.length - 1;

              return (
                <div
                  key={ev.date}
                  className={`flex gap-4 px-5 py-4 ${
                    !isLast ? "border-b border-gray-100" : ""
                  } ${hasEvent ? "bg-white" : "bg-gray-50/60"}`}
                >
                  {/* 日付列 */}
                  <div className="w-32 shrink-0">
                    <span className={`text-sm font-semibold ${dayColor(dow)}`}>
                      {ev.date.replace(/[（(].+?[）)]/, "").trim()}
                    </span>
                    {dow && (
                      <span className={`ml-1 text-xs ${dayColor(dow)}`}>
                        ({dow})
                      </span>
                    )}
                  </div>

                  {/* 内容列 */}
                  <div className="flex-1 min-w-0">
                    {hasEvent ? (
                      <div className="flex flex-col gap-1">
                        {lines.map((line, j) => (
                          <p key={j} className="text-sm text-gray-700 leading-relaxed">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-300">予定なし</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
