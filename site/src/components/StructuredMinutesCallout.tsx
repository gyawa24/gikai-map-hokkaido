import Link from "next/link";

type Props = {
  href: string;
};

export default function StructuredMinutesCallout({ href }: Props) {
  return (
    <section className="mb-5 rounded-2xl border border-[#C5D0E6] bg-white px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-[#1B3A6B]">
            この議事録を発言・質問項目別に読む
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#4A5568]">
            公式会議録の原文をもとに、発言単位・質問者別・質問項目別に整理した試験版ビューです。
            正式な内容は公式会議録をご確認ください。
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#C5D0E6] bg-[#E8EEF7] px-4 py-2 text-sm font-bold text-[#1B3A6B] transition-colors hover:bg-[#DCE7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] focus-visible:ring-offset-2"
        >
          発言・質問項目別に読む
        </Link>
      </div>
    </section>
  );
}
