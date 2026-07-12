"use client";

import dynamic from "next/dynamic";

const SearchClient = dynamic(() => import("@/components/SearchClient"), {
  ssr: false,
  loading: () => (
    <div
      className="theme-card min-h-40 animate-pulse"
      aria-label="検索を準備しています"
    />
  ),
});

export default function SearchClientLoader() {
  return <SearchClient />;
}
