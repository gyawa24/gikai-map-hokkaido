import type { Session, SessionSummary } from "@/types/session";

type SessionLike = Pick<
  Session | SessionSummary,
  "youtube_id" | "source_type" | "source_url" | "source_label" | "source_thumbnail_url"
>;

export function getSessionWatchUrl(session: SessionLike): string | null {
  if (session.source_url) return session.source_url;
  if (session.youtube_id) return `https://www.youtube.com/watch?v=${session.youtube_id}`;
  return null;
}

export function getSessionSourceLabel(session: SessionLike): string {
  if (session.source_label) return session.source_label;
  if (session.source_type === "youtube" || session.youtube_id) return "YouTubeで視聴";
  return "録画配信を視聴";
}

export function getSessionThumbnailUrl(
  session: SessionLike,
  variant: "card" | "hero" = "card"
): string | null {
  if (session.source_thumbnail_url) return session.source_thumbnail_url;
  if (!session.youtube_id) return null;
  const filename = variant === "hero" ? "maxresdefault.jpg" : "mqdefault.jpg";
  return `https://img.youtube.com/vi/${session.youtube_id}/${filename}`;
}
