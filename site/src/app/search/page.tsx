import { buildPageMetadata } from "@/lib/metadata";
import SearchClient from "@/components/SearchClient";

export const metadata = buildPageMetadata({
  title: "検索",
  description: "北海道内の市町村議会議事録・議員情報をキーワードで横断検索できます。",
  path: "/search",
});

export default function SearchPage() {
  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-5">
        <h2 className="theme-section-title text-2xl">検索</h2>
        <p className="text-sm text-[#718096] mt-1">議事録・会議録・議員を横断して探せます。</p>
      </div>
      <SearchClient />
    </div>
  );
}
