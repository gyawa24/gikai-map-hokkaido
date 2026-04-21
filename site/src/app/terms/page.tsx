import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "利用規約",
  description: "北海道議会情報マップの利用規約。",
};

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[#1B3A6B] mb-2">利用規約</h1>
        <p className="text-sm text-[#718096]">最終改定日: 2026-04-21</p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第1条（目的）
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed">
          本サイト「北海道議会情報マップ」（以下「当サイト」）は、株式会社オガワヤ（以下「当社」）が、北海道内の市町村議会に関する公開情報を市民が横断的に閲覧しやすくするために運営する、非公式の情報サイトです。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第2条（掲載情報の性質）
        </h2>
        <ol className="text-base text-[#1A202C] leading-relaxed space-y-2 list-decimal pl-6">
          <li>
            当サイトに掲載する議員情報・議事録・議決結果等は、各市議会の公式サイトで公開されている情報を基にしています。
          </li>
          <li>
            当サイトはAIによる要約・タグ付け・テーマ分類を行っており、これらは原文の理解を補助するものです。発言内容そのものを代替するものではありません。
          </li>
          <li>
            掲載内容の正確性については最大限努めますが、完全性を保証するものではありません。引用や二次利用の際は、必ず当サイトに掲載している原典リンクから元の情報をご確認ください。
          </li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第3条（免責事項）
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed">
          当サイトの利用によって利用者に生じたいかなる損害についても、当社は一切の責任を負いません。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第4条（削除・訂正依頼）
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed">
          議員氏名・発言内容・その他の記載に誤りがある場合、またはプライバシー上の懸念がある場合は、お問い合わせ窓口までご連絡ください。合理的な範囲で速やかに対応いたします。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第5条（著作権）
        </h2>
        <ol className="text-base text-[#1A202C] leading-relaxed space-y-2 list-decimal pl-6">
          <li>
            議事録・議決結果等の原資料の著作権は、各議会に帰属します。
          </li>
          <li>
            当サイト独自のUI・要約・テーマ分類の権利は、別途明示的にライセンスを付与する場合を除き、当社に帰属します。
          </li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第6条（禁止事項）
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed mb-3">次の行為を禁止します。</p>
        <ol className="text-base text-[#1A202C] leading-relaxed space-y-2 list-decimal pl-6">
          <li>当サイトへの過度な自動アクセス等、サーバーに負荷をかける行為</li>
          <li>
            掲載情報を改変して再配布し、元の発言者の意図と異なる文脈で利用する行為
          </li>
          <li>法令または公序良俗に反する目的での利用</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          第7条（お問い合わせ）
        </h2>
        <ul className="text-base text-[#1A202C] leading-relaxed space-y-1 list-disc pl-6">
          <li>
            メール:{" "}
            <a
              href="mailto:ogawayohei.hkd@gmail.com"
              className="text-[#2A5298] hover:underline"
            >
              ogawayohei.hkd@gmail.com
            </a>
          </li>
          <li>
            GitHub Issues:{" "}
            <a
              href="https://github.com/gyawa24/gikai-map-hokkaido/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2A5298] hover:underline"
            >
              gyawa24/gikai-map-hokkaido
            </a>
          </li>
        </ul>
      </section>

      <nav className="mt-10 pt-4 border-t border-[#E2E8F0] text-sm text-[#718096]">
        <Link href="/privacy" className="text-[#2A5298] hover:underline">
          プライバシーポリシー
        </Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link href="/" className="text-[#2A5298] hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </article>
  );
}
