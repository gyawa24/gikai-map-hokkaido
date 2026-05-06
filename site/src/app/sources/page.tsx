import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { getPublicInformationInventory } from "@/lib/publicInformationInventory";

export const metadata = buildPageMetadata({
  title: "掲載情報と出典",
  description:
    "地方議会ドットコムに掲載している市町村議会情報の範囲、出典、更新確認の考え方をまとめています。",
  path: "/sources",
});

function mark(value: boolean) {
  return value ? "○" : "—";
}

function badgeClass(state: string) {
  if (state === "掲載中") return "border-[#B7DEC9] bg-[#EEF9F2] text-[#166534]";
  if (state === "文字起こし確認中") return "border-[#F3D087] bg-[#FFF7E6] text-[#78451F]";
  if (state === "別情報として整理予定") return "border-[#BFD0EA] bg-[#E8EEF7] text-[#1B3A6B]";
  return "border-[#E2E8F0] bg-[#F8FAFC] text-[#4A5568]";
}

export default function SourcesPage() {
  const { rows, summary } = getPublicInformationInventory();

  return (
    <article className="page-shell max-w-6xl">
      <header className="mb-8 max-w-3xl">
        <p className="portal-subhead mb-3">公開情報の透明性</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          掲載情報と出典
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#4A5568]">
          地方議会ドットコムは、各市町村議会・北海道議会の公式サイトで公開されている情報を、市民が横断して探しやすい形に整理する非公式サイトです。
          ここでは、どの情報を掲載しているか、どの種類の公式情報をもとにしているかを一覧にしています。
        </p>
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "対象", value: summary.total, unit: "件" },
          { label: "議員一覧", value: summary.members, unit: "件" },
          { label: "議事録", value: summary.minutes, unit: "件" },
          { label: "議事録未掲載", value: summary.unavailable, unit: "件" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-[#64748B]">{item.label}</p>
            <p className="mt-2 text-3xl font-black leading-none text-[#111827]">
              {item.value}
              <span className="ml-1 text-base font-bold text-[#64748B]">{item.unit}</span>
            </p>
          </div>
        ))}
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-5">
          <h2 className="text-lg font-bold text-[#1B3A6B]">議事録の公開時期</h2>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
            会議録の公開時期は議会ごとに異なります。会議後おおむね数か月かかる場合があり、公開日が固定されていない議会もあります。
            本サイトの「再確認待ち」は公式な期限ではなく、見落としを減らすための運用上の見回り間隔です。
          </p>
        </div>
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-5">
          <h2 className="text-lg font-bold text-[#1B3A6B]">議事録の扱い</h2>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
            議事録欄には、正式な本会議会議録本文だけを入れます。一般質問要旨、議会だより、議決結果、会議結果は性格が違うため、別の情報として扱います。
          </p>
        </div>
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-5">
          <h2 className="text-lg font-bold text-[#1B3A6B]">画像PDFの扱い</h2>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
            画像PDFは文字起こしできますが、氏名や地名の読み取り誤りが起きます。原文照合と評価が済むまでは公開用の議事録として掲載しません。
          </p>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-[#E2E8F0] bg-[#FFF7E6] p-5 text-[#78451F]">
        <h2 className="text-lg font-bold">原典確認について</h2>
        <p className="mt-2 text-base leading-relaxed">
          掲載情報の確認や引用では、各議会の公式サイト・公式会議録検索システムを原典として確認してください。
          本ページでは機械的に整理できる出典種別と確認先を表示しています。個別PDFなどの直接URLは、データ構造が揃ったものから順次反映します。
        </p>
      </section>

      <section className="mb-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-[#111827]">市町村別の掲載状況</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              速報は補助情報として扱い、正式な議事録・議員一覧・暮らしのテーマ別表示を中心に整理しています。
            </p>
          </div>
          <p className="text-sm font-bold text-[#64748B]">
            文字起こし確認中 {summary.ocrWait}件 / 別情報として整理予定 {summary.altFeature}件
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[#CBD5E0] bg-white">
          <table className="min-w-[980px] w-full border-collapse text-sm">
            <thead className="bg-[#E8EEF7] text-left text-[#1B3A6B]">
              <tr>
                <th className="border-b border-[#CBD5E0] px-3 py-3 font-bold">地域</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 font-bold">自治体</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 text-center font-bold">議員</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 text-center font-bold">議事録</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 text-center font-bold">テーマ表示</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 font-bold">議事録の掲載状況</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 font-bold">出典/確認先</th>
                <th className="border-b border-[#CBD5E0] px-3 py-3 font-bold">確認日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug} className="border-b border-[#E2E8F0] last:border-b-0">
                  <td className="px-3 py-3 text-[#4A5568]">{row.region}</td>
                  <td className="px-3 py-3">
                    <Link href={`/${row.slug}`} className="font-bold text-[#1B3A6B] hover:underline">
                      {row.name}
                    </Link>
                    {row.otherInfo.length > 0 && (
                      <p className="mt-1 text-xs text-[#64748B]">{row.otherInfo.join("・")}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center font-bold text-[#1A202C]">{mark(row.hasMembers)}</td>
                  <td className="px-3 py-3 text-center font-bold text-[#1A202C]">{mark(row.hasMinutes)}</td>
                  <td className="px-3 py-3 text-center font-bold text-[#1A202C]">{mark(row.hasTopicData)}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded border px-2 py-1 text-xs font-bold ${badgeClass(row.recordState)}`}>
                      {row.recordState}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {row.sourceHref?.startsWith("http") ? (
                      <a
                        href={row.sourceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-[#2A5298] hover:underline"
                      >
                        {row.sourceLabel}
                      </a>
                    ) : row.sourceHref ? (
                      <Link href={row.sourceHref} className="font-bold text-[#2A5298] hover:underline">
                        {row.sourceLabel}
                      </Link>
                    ) : (
                      <span className="font-bold text-[#1A202C]">{row.sourceLabel}</span>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{row.sourceNote}</p>
                  </td>
                  <td className="px-3 py-3 text-[#4A5568]">{row.verifiedAt ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <nav className="mt-10 border-t border-[#E2E8F0] pt-4 text-sm text-[#718096]">
        <Link href="/terms" className="text-[#2A5298] hover:underline">
          利用規約
        </Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link href="/" className="text-[#2A5298] hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </article>
  );
}
