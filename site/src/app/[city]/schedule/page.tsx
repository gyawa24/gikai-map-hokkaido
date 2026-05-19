import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ScheduleEvent, ScheduleLinkIndex } from "@/types/schedule";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getCapabilityCityStaticParams } from "@/lib/staticCityParams";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCapabilityCityStaticParams("schedule");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `行事予定 - ${cityName}`,
    description: `${cityName}議会の行事予定を掲載しています。委員会、定例会、議会関連日程を確認できます。`,
    path: `/${city}/schedule`,
  });
}

function getSchedule(city: string): ScheduleEvent[] | ScheduleLinkIndex {
  const fp = path.join(process.cwd(), "data", city, "schedule.json");
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as ScheduleEvent[] | ScheduleLinkIndex;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && "source_url" in data) return data;
    return [];
  } catch {
    return [];
  }
}

function isScheduleLinkIndex(schedule: ScheduleEvent[] | ScheduleLinkIndex): schedule is ScheduleLinkIndex {
  return !Array.isArray(schedule);
}

function formatContent(content: string): string[] {
  if (content === "予定なし") return [];
  return content
    .split("...")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractDayOfWeek(date: string): string {
  const m = date.match(/[（(](.+?)[）)]/);
  return m ? m[1] : "";
}

function dayColor(dow: string): string {
  if (dow.startsWith("日")) return "text-red-500";
  if (dow.startsWith("土")) return "text-blue-500";
  return "text-gray-700";
}

export default async function CitySchedulePage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "schedule")) notFound();

  const cityName = municipality.name;
  const schedule = getSchedule(city);
  const events = isScheduleLinkIndex(schedule) ? [] : schedule;

  const groups = events.reduce<Record<string, ScheduleEvent[]>>((acc, ev) => {
    (acc[ev.period_label] ??= []).push(ev);
    return acc;
  }, {});

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-5">
        <h2 className="theme-section-title text-2xl">行事予定</h2>
        <p className="text-sm text-[#4A5568] mt-1">
          {cityName}議会の直近の行事予定です。
        </p>
      </div>

      {isScheduleLinkIndex(schedule) ? (
        <div className="theme-card p-6">
          <p className="mb-5 text-sm leading-relaxed text-[#4A5568]">
            {schedule.note || `${cityName}議会の会議日程は公式サイトでご確認ください。`}
          </p>

          <div className="flex flex-wrap gap-3">
            {schedule.pdf_schedules.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="theme-button theme-button-accent px-4 py-2 text-sm font-medium"
              >
                {link.label}
              </a>
            ))}

            <a
              href={schedule.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="theme-button px-4 py-2 text-sm text-[#718096] hover:text-[#1B3A6B]"
            >
              公式ページ
            </a>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="theme-card px-6 py-8 text-center text-[#718096]">
          現在、掲載されている行事予定はありません。
        </div>
      ) : (
        Object.entries(groups).map(([label, groupEvents]) => (
          <div key={label} className="mb-6">
            <div className="theme-pill-soft mb-3 inline-flex text-blue-700">
              {label}
            </div>

            <div className="theme-card overflow-hidden">
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
                    <div className="w-32 shrink-0">
                      <span
                        className={`text-sm font-semibold ${dayColor(dow)}`}
                      >
                        {ev.date.replace(/[（(].+?[）)]/, "").trim()}
                      </span>
                      {dow && (
                        <span className={`ml-1 text-xs ${dayColor(dow)}`}>
                          ({dow})
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {hasEvent ? (
                        <div className="flex flex-col gap-1">
                          {lines.map((line, j) => (
                            <p
                              key={j}
                              className="text-sm text-gray-700 leading-relaxed"
                            >
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
        ))
      )}
    </div>
  );
}
