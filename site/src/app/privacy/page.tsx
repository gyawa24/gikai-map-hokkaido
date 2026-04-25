import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "プライバシーポリシー",
  description:
    "地方議会ドットコムにおける個人情報・利用者情報の取扱いについて。",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[#1B3A6B] mb-2">
          プライバシーポリシー
        </h1>
        <p className="text-sm text-[#718096]">最終改定日: 2026-04-21</p>
      </header>

      <p className="text-base text-[#1A202C] leading-relaxed mb-6">
        本サイト「地方議会ドットコム」（以下「当サイト」）における個人情報・利用者情報の取扱いについて定めます。
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          1. 運営者
        </h2>
        <ul className="text-base text-[#1A202C] leading-relaxed space-y-1 list-disc pl-6">
          <li>運営: 株式会社オガワヤ</li>
          <li>代表者: 小川陽平（千歳市議会議員）</li>
          <li>所在地: 北海道千歳市（詳細はお問い合わせください）</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          2. 収集する情報
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed mb-3">
          当サイトは以下の情報を限定的に取得します。
        </p>
        <ul className="text-base text-[#1A202C] leading-relaxed space-y-2 list-disc pl-6">
          <li>
            <strong>アクセス時のIPアドレス</strong>：
            <code className="text-sm bg-[#F4F6F9] px-1.5 py-0.5 rounded">/api/search</code>
            の不正利用を防止する目的で一時的に保持し、リクエスト間隔の計測にのみ使用します。最大24時間で自動的に破棄されます。
          </li>
          <li>
            <strong>アクセス解析</strong>：Vercel Web Analytics による匿名の閲覧統計を利用します。本サービスはCookieを使用せず、個別の利用者を追跡しません。
          </li>
          <li>
            <strong>Cookie</strong>：当サイト自身は認証・追跡目的のCookieを使用していません。
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          3. 外部サービス
        </h2>
        <ul className="text-base text-[#1A202C] leading-relaxed space-y-2 list-disc pl-6">
          <li>
            <strong>ホスティング</strong>：Vercel Inc. のサーバーを利用しています。サーバーログは同社のプライバシーポリシーに従って管理されます。
          </li>
          <li>
            <strong>動画埋込</strong>：会議録ページで YouTube の埋込を利用する場合、YouTube のプライバシーポリシーが適用されます。
          </li>
          <li>
            <strong>議員写真</strong>：各市町村議会の公式サイトから直接配信しており、当サイト側では保存していません。
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          4. お問い合わせ
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed mb-3">
          情報の誤り、削除依頼、その他のお問い合わせはこちらへお願いします。
        </p>
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

      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1B3A6B] mb-3 pb-1 border-b border-[#E2E8F0]">
          5. 改定
        </h2>
        <p className="text-base text-[#1A202C] leading-relaxed">
          本ポリシーは予告なく改定することがあります。重要な変更がある場合はトップページで告知します。
        </p>
      </section>

      <nav className="mt-10 pt-4 border-t border-[#E2E8F0] text-sm text-[#718096]">
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
