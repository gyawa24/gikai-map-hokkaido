import { buildPageMetadata } from "@/lib/metadata";
import SearchClient from "@/components/SearchClient";

export const metadata = buildPageMetadata({
  title: "検索",
  description: "北海道内の市町村議会議事録・議員情報をキーワードで横断検索できます。",
  path: "/search",
});

export default function SearchPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-[#1B3A6B] mb-5">検索</h2>
      <SearchClient />
    </div>
  );
}
