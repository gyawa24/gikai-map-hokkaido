"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center border border-[#CBD5E0] rounded-lg bg-[#F4F6F9] text-[#718096] text-sm"
      style={{ height: "500px" }}
    >
      地図を読み込んでいます…
    </div>
  ),
});

export default function MapViewLoader() {
  return <MapView />;
}
