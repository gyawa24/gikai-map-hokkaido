import Link from "next/link";
import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "算出方法と中立性ポリシー",
  description:
    "地方議会ドットコムで表示している質問・質疑記録の件数やテーマ分類の算出方法、中立性を保つための運用方針、訂正窓口をまとめています。",
  path: "/methodology",
});

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black text-[#1B3A6B]">{title}</h2>
      <div className="mt-4 space-y-3 text-base leading-relaxed text-[#1A202C]">
        {children}
      </div>
    </section>
  );
}

function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5">
      {items.map((item, index) => (
        <li key={index} className="list-disc">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function MethodologyPage() {
  return (
    <article className="page-shell max-w-4xl">
      <nav className="mb-5 text-sm font-bold text-[#718096]" aria-label="パンくず">
        <Link href="/" className="text-[#2A5298] hover:underline">
          トップ
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span>算出方法と中立性ポリシー</span>
      </nav>

      <header className="mb-8 border-l-4 border-[#F7C948] pl-4">
        <p className="portal-subhead mb-3">METHODOLOGY & NEUTRALITY</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          算出方法と中立性ポリシー
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[#1A202C] sm:text-lg">
          地方議会ドットコムで表示している質問・質疑記録の件数やテーマ分類は、公式資料をもとに機械的に整理した参考情報です。
          ここでは、何をどう数えているか、どのように中立性を保つかを公開します。
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-[#E2E8F0] bg-[#FFF7E6] p-5 text-[#78451F]">
        <h2 className="text-lg font-bold">非公式の補助情報です</h2>
        <p className="mt-2 text-base leading-relaxed">
          掲載情報は、議会や自治体の公式資料を探しやすくするための入口です。
          引用、共有、判断に使う場合は、必ず公式会議録や公式サイトで原文を確認してください。
        </p>
      </section>

      <Section title="1. データの出典">
        <p>
          議員名簿、議事録、議決結果、予算書などは、各市町村議会、北海道議会、自治体公式サイトで公開されている資料をもとに整理しています。
          地方議会ドットコムは自治体・議会の公式サイトではありません。
        </p>
        <p>
          掲載範囲や出典の考え方は、{" "}
          <Link href="/sources" className="font-bold text-[#2A5298] hover:underline">
            掲載情報と出典
          </Link>
          {" "}のページにもまとめています。
        </p>
      </Section>

      <Section title="2. 数えているもの・いないもの">
        <p>
          現在の議員活動データは、自治体ごとの議員名簿を基準に、会議録側の質問者名を名寄せして生成しています。
          氏名の空白、敬称、役職表記などは、同じ議員として照合できるよう機械的に整えています。
        </p>
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <h3 className="text-base font-bold text-[#1B3A6B]">質問・質疑記録の件数</h3>
          <p className="mt-2">
            公式会議録の議題、議長の開始・終了宣言、質問者の発言を照合し、原文上の質問・質疑ブロックを議員名簿へ名寄せして数えます。
            一般質問・代表質問は質問者ごとの質問枠、委員会質疑は同じ議員・同じ委員会会議、本会議質疑は議案・款などの質疑ブロックへの参加を、それぞれ1件とします。
            このため、同じ定例会でも複数の議案や款で質疑した場合は複数件になります。件数は発言回数そのものではありません。
            正式会議録が未公開の会議は、公式映像の字幕に基づく記録を注意書き付きの速報として別に数え、正式版の公開後に照合して公式記録を優先します。
          </p>
        </div>
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <h3 className="text-base font-bold text-[#1B3A6B]">テーマ分類</h3>
          <p className="mt-2">
            画面では、質問記録の根拠本文に同じ表現がある「原文で確認できる語句」と、内容を探しやすくするための「AI整理テーマ」を分けて表示します。
            AI整理テーマは公式資料の見出しや原文引用ではなく、本文完全一致検索にも混ぜません。
            「教育」「子育て・保育」「福祉・介護」「防災・安全」「財政・予算」などの大分類は、質問記録内のキーワードを使った補助分類です。
          </p>
        </div>
        <BulletList
          items={[
            "質問・質疑記録の件数は、議員の仕事量全体、政策の質、地域活動、委員会活動、議案審査、住民相談などを評価するものではありません。",
            "議員名簿と議事録の氏名表記が一致しない場合、名寄せできない質問は集計から漏れることがあります。",
            "同姓の議員がいる場合などに、まれに別の議員へ質問が誤って紐づく可能性があります。お気づきの際は訂正窓口へご連絡ください。",
            "答弁、議事進行、委員長報告、採決、出欠、会派内の役割は、現在の質問・質疑記録の件数には含めていません。",
            "テーマ分類は機械的な補助分類であり、発言の趣旨や政策判断を代替するものではありません。",
          ]}
        />
      </Section>

      <Section title="3. 数値の読み方の注意">
        <p>
          議長や副議長は、議会運営上の役割や慣例により、一般質問を行わない、または質問機会が限られる場合があります。
          そのため、質問・質疑記録の件数が少ないことだけで活動が少ないと判断することはできません。
        </p>
        <p>
          質問・質疑記録の件数を表示する議員ページでは、データ化済みの議長・副議長の役職と算出方法への導線を併記します。
          役職情報がまだ構造化されていない自治体では表示できないため、公式資料を確認しながら収録範囲を広げます。
        </p>
      </Section>

      <Section title="4. 順位付けをしない方針">
        <p>
          質問・質疑記録の件数やテーマ分類は、議会でどのようなテーマが扱われたかを探すための入口です。
          議員の優劣を示すランキングや、「上位○人」といった評価表示として使うものではありません。
        </p>
        <p>
          活動データを強化する場合も、数値による競争を促す見せ方ではなく、公式資料へたどり着きやすくすることを優先します。
        </p>
      </Section>

      <Section title="5. 全議員同一基準">
        <p>
          議員情報、質問・質疑記録の件数、テーマ分類は、同じテンプレート、同じデータソース、同じ集計ロジックで表示します。
          特定の議員だけに紹介文や評価文を加えることはしません。
        </p>
        <p>
          運営者の小川陽平は、千歳市議会議員（国民民主党）です。
          運営者自身のページも、他の議員と同じ基準、同じデータ、同じテンプレートで表示します。
        </p>
      </Section>

      <Section title="6. AI生成コンテンツの扱い">
        <p>
          一部のページでは、AIによる要約、抜粋、テーマ分類、質問と答弁の整理を表示します。
          これらは理解を助けるための補助情報であり、正確性を保証するものではありません。
        </p>
        <p>
          発言内容を引用・共有する場合は、必ず公式会議録、動画、PDFなどの原文で確認してください。
          AI生成部分に誤りがある場合は、利用規約第4条の窓口から訂正依頼を送ることができます。
        </p>
      </Section>

      <Section title="7. 選挙期間中の運用">
        <p>
          選挙の告示日から投票日までは、当該自治体の議員に関するデータ追加、表示変更、集計ロジック変更を行わない方針です。
          これは、選挙期間中に特定の議員に有利または不利に見える変更を避けるための運用上のルールです。
        </p>
        <p>
          ただし、本人または代理人からの訂正依頼への対応は例外です。
          利用規約第4条に基づく訂正、削除、非表示化、明らかな誤記修正は、選挙期間中でも対応します。
        </p>
        <p>
          この方針は、本サイトの運用方針であり、公職選挙法などの法令対応を保証するものではありません。
        </p>
      </Section>

      <Section title="8. 訂正窓口">
        <p>
          議員氏名、発言内容、所属会派、議決結果、AI要約、テーマ分類などに誤りがある場合は、利用規約第4条の窓口までご連絡ください。
        </p>
        <p>
          原則として、AIによる要約・タグ・テーマ分類・Q&amp;A抽出については1営業日以内に初動し、掲載内容の確認は3営業日以内を目安に対応します。
          対応結果は、ご連絡をいただいた方にメールで報告します。
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/terms" className="theme-pill-soft text-[#2A5298]">
            利用規約第4条を見る
          </Link>
          <a href="mailto:ogawayohei.hkd@gmail.com" className="theme-pill-soft text-[#2A5298]">
            メールで連絡する
          </a>
        </div>
      </Section>

      <nav className="mt-10 border-t border-[#E2E8F0] pt-4 text-sm text-[#718096]">
        <Link href="/about" className="font-bold text-[#2A5298] hover:underline">
          地方議会ドットコムとは
        </Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link href="/sources" className="font-bold text-[#2A5298] hover:underline">
          掲載情報と出典
        </Link>
        <span className="mx-2" aria-hidden="true">·</span>
        <Link href="/" className="font-bold text-[#2A5298] hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </article>
  );
}
