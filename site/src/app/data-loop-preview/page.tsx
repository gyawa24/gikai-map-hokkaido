import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import DataLoopPreviewAccessGate, {
  DataLoopPreviewLogoutButton,
} from "@/components/data-loop-preview/DataLoopPreviewAccessGate";
import DataLoopBudgetPreview from "@/components/data-loop-preview/DataLoopBudgetPreview";
import { getDataLoopPreview } from "@/lib/dataLoopPreview";
import {
  getResearchAuthConfig,
  RESEARCH_SESSION_COOKIE_NAME,
  verifyResearchSessionToken,
} from "@/lib/researchAuth";

export const metadata: Metadata = {
  title: "予算Data Loop 限定プレビュー",
  description: "5市のR7・R8予算Data Loopを確認するパスワード付きテスト画面です。",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export const dynamic = "force-dynamic";

export default async function DataLoopPreviewPage() {
  const authConfig = getResearchAuthConfig();
  const sessionToken = (await cookies()).get(RESEARCH_SESSION_COOKIE_NAME)?.value;
  const authenticated = authConfig
    ? await verifyResearchSessionToken(sessionToken, authConfig)
    : false;

  if (!authenticated) {
    return (
      <article className="page-shell max-w-5xl">
        <nav className="mb-5 text-sm font-bold text-[#718096]" aria-label="パンくず">
          <Link href="/" className="text-[#2A5298] hover:underline">トップ</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <span>予算Data Loop</span>
        </nav>
        <header className="mb-6 border-l-4 border-[#F7C948] pl-4">
          <p className="portal-subhead mb-3">BUDGET DATA LOOP</p>
          <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
            予算Data Loop 限定プレビュー
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#1A202C] sm:text-lg">
            発見・構造化・比較・出典・欠損管理を、一つの流れで確認するテスト画面です。
          </p>
        </header>
        <DataLoopPreviewAccessGate configured={Boolean(authConfig)} />
      </article>
    );
  }

  const preview = getDataLoopPreview();

  return (
    <article className="page-shell max-w-7xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-sm font-bold text-[#718096]" aria-label="パンくず">
          <Link href="/" className="text-[#2A5298] hover:underline">トップ</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <span>予算Data Loop</span>
        </nav>
        <DataLoopPreviewLogoutButton />
      </div>

      <header className="mb-7 border-l-4 border-[#F7C948] pl-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded bg-[#F7C948] px-2 py-1 text-sm font-black text-[#1A202C]">限定テスト</span>
          <span className="rounded bg-[#E8EEF7] px-2 py-1 text-sm font-bold text-[#2A5298]">R7・R8</span>
          <span className="rounded bg-[#E8EEF7] px-2 py-1 text-sm font-bold text-[#2A5298]">5市</span>
        </div>
        <p className="portal-subhead mb-3">BUDGET DATA LOOP</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          予算Data Loop 限定プレビュー
        </h1>
        <p className="mt-3 max-w-4xl text-base leading-relaxed text-[#1A202C] sm:text-lg">
          自治体予算の原表値、前年比較、構造変更、出典、未取得・未評価の状態を同じ画面で確認します。
        </p>
      </header>

      {preview ? (
        <DataLoopBudgetPreview data={preview} />
      ) : (
        <section className="theme-alert px-5 py-5 text-[#78451F]" role="alert">
          <h2 className="text-lg font-bold">プレビューデータを準備できませんでした</h2>
          <p className="mt-2 text-sm leading-relaxed">
            管理者が5市の技術検証と派生データ生成を完了してから、もう一度開いてください。
          </p>
        </section>
      )}
    </article>
  );
}
