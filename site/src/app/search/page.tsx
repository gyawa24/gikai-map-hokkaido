import SearchClient from "@/components/SearchClient";

export const metadata = { title: "検索 | 北海道議会情報マップ" };

export default function SearchPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-[#1B3A6B] mb-5">検索</h2>
      <SearchClient />
    </div>
  );
}
