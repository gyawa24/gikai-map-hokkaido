import Link from "next/link";
import MapViewLoader from "@/components/MapViewLoader";

const CITIES = [
  { id: "chitose", name: "千歳市議会", href: "/chitose", color: "#1B3A6B" },
  { id: "eniwa", name: "恵庭市議会", href: "/eniwa", color: "#16a34a" },
  { id: "tomakomai", name: "苫小牧市議会", href: "/tomakomai", color: "#1D4ED8" },
];

export default function MapPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">地図で議会を探す</h2>
        <p className="text-base text-[#4A5568]">
          ピンをクリックすると各市議会の概要が表示されます。
        </p>
      </section>

      <div className="mb-4">
        <MapViewLoader />
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-3 mb-8">
        {CITIES.map((city) => (
          <Link
            key={city.id}
            href={city.href}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full border border-[#CBD5E0] hover:border-[#1B3A6B] text-sm text-[#1A202C] transition-colors shadow-sm"
          >
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: city.color }}
              aria-hidden="true"
            />
            {city.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
