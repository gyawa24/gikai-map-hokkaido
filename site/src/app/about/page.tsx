import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import {
  OWNER_X_URL,
  SITE_NAME,
  SITE_URL,
  SITE_X_URL,
  buildPageMetadata,
} from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

const description =
  "地方議会ドットコムは、北海道内の市町村議会と北海道議会の議員情報・議事録・議決結果を横断して探せる非公式の市民向け情報サイトです。";

export const metadata = buildPageMetadata({
  title: "地方議会ドットコムとは",
  description,
  path: "/about",
});

export default function AboutPage() {
  const pageUrl = `${SITE_URL}/about`;
  const structuredData = [
    buildBreadcrumbList([
      { name: "トップ", path: "/" },
      { name: "地方議会ドットコムとは", path: "/about" },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: "地方議会ドットコムとは",
      url: pageUrl,
      description,
      isPartOf: {
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
      },
      about: {
        "@type": "Thing",
        name: "地方議会",
      },
      inLanguage: "ja-JP",
    },
  ];

  return (
    <article className="page-shell max-w-4xl">
      <JsonLd data={structuredData} />

      <nav className="mb-5 text-sm font-bold text-[#718096]" aria-label="パンくず">
        <Link href="/" className="text-[#2A5298] hover:underline">
          トップ
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span>地方議会ドットコムとは</span>
      </nav>

      <header className="mb-8 border-l-4 border-[#F7C948] pl-4">
        <p className="portal-subhead mb-3">ABOUT CHIHOU GIKAI DOTTOKOMU</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          地方議会ドットコムとは
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[#1A202C] sm:text-lg">
          地方議会ドットコムは、北海道内の市町村議会と北海道議会の議員情報・議事録・議決結果を横断して探せる、非公式の市民向け情報サイトです。
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-[#111827]">何を調べられるサイトか</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              title: "議員から探す",
              body: "議員名、所属、自治体ごとの議員一覧から、発言や関連情報へ進めます。",
            },
            {
              title: "議事録から探す",
              body: "市町村をまたいで、議会で話されたテーマや言葉を横断検索できます。",
            },
            {
              title: "テーマから探す",
              body: "子育て、福祉、予算、防災など、暮らしに近い政策テーマから議論を追えます。",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <h3 className="text-base font-black text-[#1B3A6B]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-5">
          <h2 className="text-lg font-bold text-[#1B3A6B]">なぜ作っているか</h2>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
            地方議会では、給食、除雪、介護、交通、防災、予算など、暮らしに近いテーマが日々議論されています。
            しかし、議事録や議員情報は自治体ごとに公開形式が違い、初めて調べる人には探しにくいことがあります。
            その入口を、できるだけわかりやすく整えるために運営しています。
          </p>
        </div>

        <div className="rounded-lg border border-[#CBD5E0] bg-white p-5">
          <h2 className="text-lg font-bold text-[#1B3A6B]">まずは北海道から</h2>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
            現在は北海道内の179市町村と北海道議会を対象に、議員名簿、議事録、議決結果、予算書などを順次整理しています。
            将来的には、地方議会を調べるための入口として、より広い地域にも展開できる形を目指しています。
          </p>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-[#E2E8F0] bg-[#FFF7E6] p-5 text-[#78451F]">
        <h2 className="text-lg font-bold">非公式サイトです</h2>
        <p className="mt-2 text-base leading-relaxed">
          地方議会ドットコムは、自治体・議会の公式サイトではありません。
          掲載情報は公式資料をもとに整理していますが、引用、数字、議決結果、発言内容を利用する場合は、必ず各議会・自治体の公式資料で確認してください。
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/sources" className="theme-pill-soft border-[#F3D087] bg-white text-[#78451F]">
            掲載情報と出典を見る
          </Link>
          <Link href="/methodology" className="theme-pill-soft border-[#F3D087] bg-white text-[#78451F]">
            算出方法と中立性を見る
          </Link>
          <Link href="/terms" className="theme-pill-soft border-[#F3D087] bg-white text-[#78451F]">
            利用規約を見る
          </Link>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-[#CBD5E0] bg-white p-5">
        <h2 className="text-lg font-bold text-[#1B3A6B]">運営と連絡先</h2>
        <p className="mt-3 text-base leading-relaxed text-[#1A202C]">
          運営者は小川陽平です。掲載情報の誤り、削除・訂正依頼、改善提案はメールまたは公式Xから連絡できます。
        </p>
        <ul className="mt-4 space-y-2 text-base text-[#1A202C]">
          <li>
            メール:{" "}
            <a href="mailto:ogawayohei.hkd@gmail.com" className="font-bold text-[#2A5298] hover:underline">
              ogawayohei.hkd@gmail.com
            </a>
          </li>
          <li>
            公式X:{" "}
            <a href={SITE_X_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-[#2A5298] hover:underline">
              @chihougikai
            </a>
          </li>
          <li>
            運営者X:{" "}
            <a href={OWNER_X_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-[#2A5298] hover:underline">
              @yoheiogawa_DPFP
            </a>
          </li>
        </ul>
      </section>

      <nav className="mt-10 border-t border-[#E2E8F0] pt-4 text-sm text-[#718096]">
        <Link href="/search" className="font-bold text-[#2A5298] hover:underline">
          横断検索へ
        </Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link href="/" className="font-bold text-[#2A5298] hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </article>
  );
}
