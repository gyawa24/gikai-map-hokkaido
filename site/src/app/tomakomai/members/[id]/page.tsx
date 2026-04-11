import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Member } from "@/types/member";

function getMembers(): Member[] {
  const fp = path.join(process.cwd(), "data", "tomakomai", "members.json");
  return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
}

export async function generateStaticParams() {
  const members = getMembers();
  return members.map((m) => ({ id: String(m.seat_number) }));
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const members = getMembers();
  const member = members.find((m) => m.seat_number === Number(id));
  if (!member) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/tomakomai" className="hover:text-[#1B3A6B] transition-colors">議員一覧</Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{member.name}</span>
      </nav>

      {/* プロフィールカード */}
      <section className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-6 mb-6">
        <div className="flex items-start gap-5">
          {member.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              className="w-28 h-40 object-cover rounded-lg border border-[#E2E8F0] shadow-sm shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">
                {member.seat_number}番
              </span>
            </div>
            <h2 className="text-2xl font-bold text-[#1A202C] leading-snug">{member.name}</h2>
            <p className="text-sm text-[#718096] mt-0.5">{member.furigana}</p>
          </div>
        </div>

        <hr className="border-[#E2E8F0] my-4" />

        <dl className="space-y-3">
          {member.party && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">政党</dt>
              <dd className="text-sm text-[#1A202C]">{member.party}</dd>
            </div>
          )}
          {member.faction && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">会派</dt>
              <dd>
                <span className="text-sm text-[#1A202C] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
                  {member.faction}
                </span>
              </dd>
            </div>
          )}
          {member.committees.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">委員会</dt>
              <dd className="flex flex-wrap gap-1">
                {member.committees.map((c) => (
                  <span key={c} className="text-sm text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
                    {c}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {member.votes && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">得票数</dt>
              <dd className="text-sm text-[#1A202C]">{member.votes.toLocaleString()}票</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="bg-[#F4F6F9] rounded-lg p-6 text-center">
        <p className="text-sm text-[#718096]">質問活動データは準備中です</p>
      </div>
    </div>
  );
}
