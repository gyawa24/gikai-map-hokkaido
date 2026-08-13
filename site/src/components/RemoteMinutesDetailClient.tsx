"use client";

import { useEffect, useState } from "react";
import type { MinutesEnriched, MinutesIndexItem, MinutesSession } from "@/types/minutes";
import { minutesContentLabel, visibleMinutesEnriched } from "@/lib/minutesPresentation";
import MinutesDetailClient from "./MinutesDetailClient";
import StructuredMinutesCallout from "./StructuredMinutesCallout";

type Props = {
  cityName: string;
  sessionUrl: string;
  enrichedUrl: string;
  initialSession?: MinutesIndexItem;
  structuredMinutesHref?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; session: MinutesSession; enriched: MinutesEnriched | null }
  | { status: "error"; message: string };

function typeCategory(typeLabel: string): string {
  if (
    typeLabel.includes("定例会") &&
    !typeLabel.includes("補正") &&
    !typeLabel.includes("委員会")
  ) {
    return "定例会";
  }
  if (typeLabel.includes("臨時会")) return "臨時会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "";
}

function MinutesHeading({
  name,
  japaneseYear,
  typeLabel,
  scheduleCount,
  contentLabel,
}: {
  name: string;
  japaneseYear?: string;
  typeLabel?: string;
  scheduleCount?: number;
  contentLabel?: string;
}) {
  const category = typeCategory(typeLabel ?? "");
  return (
    <section className="mb-5">
      {(category || japaneseYear) && (
        <div className="mb-2 flex items-center gap-2">
          {category && <span className="theme-pill-soft text-[#2A5298]">{category}</span>}
          {japaneseYear && <span className="text-xs text-[#718096]">{japaneseYear}</span>}
        </div>
      )}
      <h1 className="theme-section-title mb-2 text-2xl leading-snug">{name}</h1>
      {(scheduleCount !== undefined || contentLabel !== undefined) && (
        <div className="flex flex-wrap gap-4 text-sm text-[#4A5568]">
          {scheduleCount !== undefined && <span>{scheduleCount}日程</span>}
          {contentLabel !== undefined && <span>{contentLabel}</span>}
        </div>
      )}
    </section>
  );
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "force-cache" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`failed to load ${url}`);
  }
  return (await response.json()) as T;
}

export default function RemoteMinutesDetailClient({
  cityName,
  sessionUrl,
  enrichedUrl,
  initialSession,
  structuredMinutesHref,
}: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [session, enriched] = await Promise.all([
          fetchJson<MinutesSession>(sessionUrl),
          fetchJson<MinutesEnriched>(enrichedUrl).catch(() => null),
        ]);
        if (cancelled) return;
        if (!session) {
          setState({ status: "error", message: "議事録データを取得できませんでした。" });
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
    };
  }, [sessionUrl, enrichedUrl]);

  if (state.status === "loading") {
    return (
      <>
        <MinutesHeading
          name={initialSession?.name ?? `${cityName}議会 議事録`}
          japaneseYear={initialSession?.japanese_year}
          typeLabel={initialSession?.type_label}
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
          name={initialSession?.name ?? `${cityName}議会 議事録`}
          japaneseYear={initialSession?.japanese_year}
          typeLabel={initialSession?.type_label}
          scheduleCount={initialSession?.schedule_count}
        />
        {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}
        <div className="theme-alert p-5">
          <p className="text-sm font-semibold text-[#7A5A00]">{state.message}</p>
          <p className="mt-2 text-xs text-[#7A5A00]">
            時間をおいて再読み込みしてください。公式会議録の確認もあわせてお願いします。
          </p>
        </div>
      </>
    );
  }

  const { session } = state;
  const enriched = visibleMinutesEnriched(session, state.enriched);

  return (
    <>
      <MinutesHeading
        name={session.name}
        japaneseYear={session.japanese_year}
        typeLabel={session.type_label}
        scheduleCount={session.schedules.length}
        contentLabel={minutesContentLabel(session)}
      />

      {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}

      <MinutesDetailClient
        session={session}
        enriched={enriched}
        cityName={cityName}
      />
    </>
  );
}
