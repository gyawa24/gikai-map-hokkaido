"use client";

import { useEffect, useState } from "react";
import type { MinutesEnriched, MinutesIndexItem, MinutesSession } from "@/types/minutes";
import { minutesContentLabel, minutesScheduleUnit, visibleMinutesEnriched } from "@/lib/minutesPresentation";
import MinutesDetailClient from "./MinutesDetailClient";
import StructuredMinutesCallout from "./StructuredMinutesCallout";
import MinutesHeading from "./MinutesHeading";
import MinutesSourceLink from "./MinutesSourceLink";
import type { MinutesSource } from "@/lib/minutesSource";
import { isMinutesSession } from "@/lib/minutesSessionValidation";

type Props = {
  cityName: string;
  sessionUrl: string;
  fallbackSessionUrl?: string;
  officialSource?: MinutesSource | null;
  enrichedUrl: string;
  initialSession?: MinutesIndexItem;
  structuredMinutesHref?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; session: MinutesSession; enriched: MinutesEnriched | null }
  | { status: "error"; message: string };

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`failed to load ${url}`);
  }
  return (await response.json()) as T;
}

export default function RemoteMinutesDetailClient({
  cityName,
  sessionUrl,
  fallbackSessionUrl,
  officialSource,
  enrichedUrl,
  initialSession,
  structuredMinutesHref,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const [session, enriched] = await Promise.all([
          fetchJson<unknown>(sessionUrl, controller.signal).then((value) =>
            value === null && fallbackSessionUrl ? fetchJson<unknown>(fallbackSessionUrl, controller.signal) : value
          ),
          fetchJson<MinutesEnriched>(enrichedUrl, controller.signal).catch(() => null),
        ]);
        if (cancelled) return;
        if (!isMinutesSession(session, initialSession?.council_id ?? "")) {
          setState({ status: "error", message: "収録本文を確認できませんでした。時間をおいて再度お試しください。" });
          return;
        }
        setState({ status: "loaded", session, enriched });
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "議事録の読み込み中にエラーが発生しました。" });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionUrl, fallbackSessionUrl, enrichedUrl, initialSession?.council_id, attempt]);

  if (state.status === "loading") {
    return (
      <>
        <MinutesHeading
          cityName={cityName}
          indexItem={initialSession}
          officialSource={officialSource}
          name={initialSession?.name ?? `${cityName}議会 議事録`}
          japaneseYear={initialSession?.japanese_year}
          scheduleCount={initialSession?.schedule_count}
        />
        {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}
        <div className="theme-card-soft p-5">
          <p className="text-sm text-[#4A5568]">議事録本文を読み込んでいます。</p>
        </div>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <MinutesHeading
          cityName={cityName}
          indexItem={initialSession}
          officialSource={officialSource}
          name={initialSession?.name ?? `${cityName}議会 議事録`}
          japaneseYear={initialSession?.japanese_year}
          scheduleCount={initialSession?.schedule_count}
        />
        {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}
        <div className="theme-alert p-5">
          <p className="text-sm font-semibold text-[#7A5A00]">{state.message}</p>
          <p className="mt-2 text-sm text-[#7A5A00]">
            未掲載という意味ではありません。公式会議録もご確認ください。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}
              className="min-h-11 rounded-lg border border-[#1B3A6B] bg-white px-4 text-sm font-semibold text-[#1B3A6B] hover:bg-[#E8EEF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]">再読み込み</button>
            <MinutesSourceLink source={officialSource ?? null} />
          </div>
        </div>
      </>
    );
  }

  const { session } = state;
  const enriched = visibleMinutesEnriched(session, state.enriched);

  return (
    <>
      <MinutesHeading
          cityName={cityName}
          indexItem={initialSession}
          officialSource={officialSource}
        name={session.name}
        japaneseYear={session.japanese_year}
        scheduleCount={session.schedules.length}
        scheduleUnit={minutesScheduleUnit(session)}
        contentLabel={minutesContentLabel(session)}
      />

      {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}

      <MinutesDetailClient
        session={session}
        enriched={enriched}
        cityName={cityName}
        officialSource={officialSource}
      />
    </>
  );
}
