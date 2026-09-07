import type { MinutesSource } from "@/lib/minutesSource";

export default function MinutesSourceLink({ source }: { source: MinutesSource | null }) {
  return source ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#2A5298] underline underline-offset-4 hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]">
      {source.label}
      <span aria-hidden="true">↗</span>
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  ) : <p className="text-sm text-[#4A5568]">公式原典のURLは確認中です。</p>;
}
