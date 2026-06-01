"use client";

import { useEffect, useState } from "react";
import type { MinutesEnriched, MinutesSession } from "@/types/minutes";
import MinutesDetailClient from "./MinutesDetailClient";

type Props = {
  cityName: string;
  sessionUrl: string;
  enrichedUrl: string;
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
      <div className="theme-card-soft p-5">
        <p className="text-sm text-[#4A5568]">議事録本文を読み込んでいます。</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="theme-alert p-5">
        <p className="text-sm font-semibold text-[#7A5A00]">{state.message}</p>
        <p className="mt-2 text-xs text-[#7A5A00]">
          時間をおいて再読み込みしてください。公式会議録の確認もあわせてお願いします。
        </p>
      </div>
    );
  }

  const { session, enriched } = state;
  const category = typeCategory(session.type_label);
  const totalSpeeches = session.schedules.reduce(
    (acc, schedule) =>
      acc + schedule.minutes.filter((minute) => minute.minute_type !== "名簿").length,
    0
  );

  return (
    <>
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          {category && (
            <span className="theme-pill-soft text-[#2A5298]">{category}</span>
          )}
          <span className="text-xs text-[#718096]">{session.japanese_year}</span>
        </div>
        <h2 className="theme-section-title mb-2 text-2xl leading-snug">
          {session.name}
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-[#4A5568]">
          <span>{session.schedules.length}日程</span>
          <span>{totalSpeeches}件の発言・議題</span>
        </div>
      </section>

      <MinutesDetailClient
        session={session}
        enriched={enriched}
        cityName={cityName}
      />
    </>
  );
}
