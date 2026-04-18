import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getMunicipality } from "@/lib/municipalities";

type Candidate = {
  name: string;
  furigana: string;
  party?: string;
  votes?: number;
  result: string;
  note?: string;
};

type ElectionData = {
  election_date: string;
  election_name: string;
  city: string;
  seats: number;
  total_candidates: number;
  turnout?: number;
  source?: string;
  candidates: Candidate[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return {
    title: `選挙結果 - ${cityName}`,
    description: `${cityName}議会議員選挙の結果（得票数・当落）を掲載しています。`,
    openGraph: {
      title: `${cityName}議会 選挙結果`,
      description: `${cityName}議会議員選挙の結果（得票数・当落）を掲載しています。`,
    },
  };
}

function getElectionData(city: string): ElectionData | null {
  const fp = path.join(process.cwd(), "data", city, "election.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as ElectionData;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function partyBadgeClass(party: string | undefined): string {
  if (!party) return "bg-gray-100 text-gray-700";
  if (party.includes("自由民主") || party.includes("自民"))
    return "bg-blue-50 text-blue-800";
  if (party.includes("公明")) return "bg-yellow-50 text-yellow-800";
  if (party.includes("立憲") || party.includes("民主"))
    return "bg-green-50 text-green-800";
  if (party.includes("共産")) return "bg-red-50 text-red-800";
  if (party.includes("維新")) return "bg-orange-50 text-orange-800";
  return "bg-gray-100 text-gray-700";
}

export default async function CityElectionPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality?.features.includes("election")) notFound();

  const cityName = municipality.name;
  const data = getElectionData(city);

  if (!data) {
    return (
      <div>
        <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
          <Link
            href={`/${city}`}
            className="hover:text-[#1B3A6B] transition-colors"
          >
            議員一覧
          </Link>
          <span aria-hidden="true">›</span>
          <span className="text-[#1A202C]">選挙結果</span>
        </nav>
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          選挙データを準備中です。
        </div>
      </div>
    );
  }

  const elected = data.candidates.filter((c) => c.result === "当選");
  const notElected = data.candidates.filter((c) => c.result !== "当選");

  return (
    <div className="max-w-2xl mx-auto">
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">選挙結果</span>
      </nav>

      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-3">
          {data.election_name}
        </h2>
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-5 flex flex-wrap gap-6">
          <div>
            <p className="text-xs font-medium text-[#718096]">執行日</p>
            <p className="text-sm text-[#1A202C] font-semibold mt-0.5">
              {formatDate(data.election_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#718096]">定数</p>
            <p className="text-sm text-[#1A202C] font-semibold mt-0.5">
              {data.seats}名
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#718096]">立候補者数</p>
            <p className="text-sm text-[#1A202C] font-semibold mt-0.5">
              {data.total_candidates}名
            </p>
          </div>
          {data.turnout != null && (
            <div>
              <p className="text-xs font-medium text-[#718096]">投票率</p>
              <p className="text-sm text-[#1A202C] font-semibold mt-0.5">
                {data.turnout.toFixed(2)}%
              </p>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-col gap-2">
          {[...elected, ...notElected].map((c, i) => {
            const isElected = c.result === "当選";
            return (
              <div
                key={i}
                className={`bg-white rounded-lg border shadow-sm p-4 flex items-start gap-4 ${
                  isElected ? "border-[#CBD5E0]" : "border-[#E2E8F0] opacity-70"
                }`}
              >
                <div className="shrink-0 w-7 text-center">
                  <span className="text-sm font-semibold text-[#718096]">
                    {i + 1}
                  </span>
                </div>

                <div className="shrink-0 pt-0.5">
                  {isElected ? (
                    <span className="inline-block text-xs font-bold px-2 py-0.5 bg-[#1B3A6B] text-white rounded">
                      当選
                    </span>
                  ) : (
                    <span className="inline-block text-xs font-bold px-2 py-0.5 bg-gray-200 text-gray-500 rounded">
                      落選
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-bold text-[#1A202C]">
                      {c.name}
                    </span>
                    <span className="text-xs text-[#718096]">{c.furigana}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {c.party && (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${partyBadgeClass(
                          c.party
                        )}`}
                      >
                        {c.party}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {c.votes != null ? (
                    <>
                      <span className="text-sm font-bold text-[#1A202C]">
                        {typeof c.votes === "number" &&
                        !Number.isInteger(c.votes)
                          ? c.votes.toFixed(3)
                          : c.votes.toLocaleString()}
                      </span>
                      <span className="text-xs text-[#718096] ml-0.5">票</span>
                      {c.note && (
                        <p className="text-xs text-[#A0AEC0] mt-0.5">
                          {c.note}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-[#A0AEC0]">―</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {data.source && (
          <p className="text-xs text-[#718096] mt-4">
            出典:{" "}
            <a
              href={data.source}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#1B3A6B] transition-colors"
            >
              {data.city}選挙管理委員会
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
