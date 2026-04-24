"use client";

import { useEffect, useState, useCallback } from "react";

type Council = { kind: "council"; slug: string; council_id: number };
type Minute = {
  kind: "minute";
  slug: string;
  council_id: number;
  schedule_id: number;
  minute_id: number;
};
export type LikeTarget = Council | Minute;

type Props = {
  target: LikeTarget;
  size?: "sm" | "md";
  className?: string;
};

function localKey(target: LikeTarget): string {
  if (target.kind === "council") {
    return `liked:council:${target.slug}:${target.council_id}`;
  }
  return `liked:minute:${target.slug}:${target.council_id}:${target.schedule_id}:${target.minute_id}`;
}

function queryString(target: LikeTarget): string {
  const params = new URLSearchParams();
  params.set("kind", target.kind);
  params.set("slug", target.slug);
  params.set("council_id", String(target.council_id));
  if (target.kind === "minute") {
    params.set("schedule_id", String(target.schedule_id));
    params.set("minute_id", String(target.minute_id));
  }
  return params.toString();
}

export default function LikeButton({ target, size = "md", className = "" }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setLiked(typeof window !== "undefined" && localStorage.getItem(localKey(target)) === "1");
    let cancelled = false;
    fetch(`/api/like?${queryString(target)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && typeof data.count === "number") setCount(data.count);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const toggle = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const willLike = !liked;
    setLiked(willLike);
    setCount((c) => (c ?? 0) + (willLike ? 1 : -1));
    try {
      const res = await fetch("/api/like", {
        method: willLike ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      const data = await res.json();
      if (typeof data.count === "number") setCount(data.count);
      if (typeof window !== "undefined") {
        if (willLike) localStorage.setItem(localKey(target), "1");
        else localStorage.removeItem(localKey(target));
      }
    } catch {
      // ロールバック
      setLiked(!willLike);
      setCount((c) => (c ?? 0) + (willLike ? -1 : 1));
    } finally {
      setPending(false);
    }
  }, [target, liked, pending]);

  const padding = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? "いいねを取り消す" : "いいねする"}
      className={`inline-flex items-center gap-1 rounded-full border transition-colors ${padding} ${
        liked
          ? "bg-[#FFE0E0] border-[#E06060] text-[#C03030] hover:bg-[#FFCFCF]"
          : "bg-white border-[#CBD5E0] text-[#4A5568] hover:border-[#E06060] hover:text-[#C03030]"
      } ${pending ? "opacity-60 cursor-wait" : "cursor-pointer"} ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={liked ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconSize}
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span className="tabular-nums font-semibold">
        {count ?? "…"}
      </span>
    </button>
  );
}
