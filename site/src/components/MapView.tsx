"use client";

import { useEffect, useRef } from "react";

type CityMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color: string;
  memberCount: number;
  factionCount: number;
  href: string;
};

const CITIES: CityMarker[] = [
  {
    id: "chitose",
    name: "千歳市",
    lat: 42.8194,
    lng: 141.6508,
    color: "#1B3A6B",
    memberCount: 23,
    factionCount: 8,
    href: "/chitose",
  },
  {
    id: "eniwa",
    name: "恵庭市",
    lat: 42.8769,
    lng: 141.5781,
    color: "#16a34a",
    memberCount: 21,
    factionCount: 5,
    href: "/eniwa",
  },
  {
    id: "tomakomai",
    name: "苫小牧市",
    lat: 42.6328,
    lng: 141.6044,
    color: "#1D4ED8",
    memberCount: 27,
    factionCount: 7,
    href: "/tomakomai",
  },
];

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!isMounted || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: [42.75, 141.62],
        zoom: 10,
        zoomControl: true,
      });

      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      for (const city of CITIES) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="
            width: 28px;
            height: 28px;
            border-radius: 50% 50% 50% 0;
            background-color: ${city.color};
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            transform: rotate(-45deg);
          "></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          popupAnchor: [0, -30],
        });

        const popup = L.popup({ maxWidth: 240 }).setContent(`
          <div style="font-family: 'Hiragino Sans', sans-serif; padding: 4px 2px;">
            <p style="font-size: 16px; font-weight: 700; color: #1A202C; margin: 0 0 8px;">${city.name}議会</p>
            <div style="display: flex; gap: 16px; font-size: 14px; color: #4A5568; margin-bottom: 12px;">
              <span>議員 <strong style="color: #1A202C;">${city.memberCount}</strong> 名</span>
              <span>会派 <strong style="color: #1A202C;">${city.factionCount}</strong> 会派</span>
            </div>
            <a
              href="${city.href}"
              style="
                display: inline-block;
                padding: 6px 14px;
                background-color: ${city.color};
                color: white;
                font-size: 13px;
                font-weight: 600;
                border-radius: 6px;
                text-decoration: none;
              "
            >議員一覧を見る →</a>
          </div>
        `);

        L.marker([city.lat, city.lng], { icon }).addTo(map).bindPopup(popup);
      }
    })();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mapInstanceRef.current as any).remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapRef}
      style={{ height: "500px", width: "100%", borderRadius: "8px" }}
      className="border border-[#CBD5E0] shadow-sm"
    />
  );
}
