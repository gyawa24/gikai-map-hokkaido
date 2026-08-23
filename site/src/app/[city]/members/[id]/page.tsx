import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity, MemberActivitySession } from "@/types/member";
import JsonLd from "@/components/JsonLd";
import { getMunicipality } from "@/lib/municipalities";
import MemberShareButtons from "@/components/MemberShareButtons";
import { withPublicMemberPhotoUrls } from "@/lib/memberPhotos";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

// 会議名から西暦を推定（令和◯年 → 2018+N）。グルーピング用。
function yearFromSessionName(name: string): string {
  const norm = (name ?? "").replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  if (west) return west[1];
  return "不明";
}

function searchHref(city: string, cityName: string, query: string): string {
  const params = new URLSearchParams({ city, cityName, q: query });
  return `/search?${params.toString()}`;
}

function activityYear(session: MemberActivitySession): string {
  return session.date?.slice(0, 4) || session.year || yearFromSessionName(session.session);
}

function formatActivityDate(date: string | undefined): string {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : "";
}

function questionKindLabel(kind: MemberActivitySession["question_kind"]): string {
  if (kind === "committee_question") return "委員会質疑";
  if (kind === "representative_question") return "代表質問";
  if (kind === "plenary_question") return "本会議質疑";
  if (kind === "general_question") return "一般質問";
  return "質問・質疑";
}

// Cloudflare Workers の静的アセットキャッシュは読み取り専用。
// 未生成の議員ページは request-time render にして、ISR キャッシュ書き込みを避ける。
export const dynamicParams = true;
export const dynamic = "force-dynamic";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

async function fetchRawJson<T>(remotePath: string): Promise<T | null> {
  try {
    const res = await fetch(`${RAW_BASE}/${remotePath}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getMembersLocal(city: string): Member[] {
  try {
    const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "members.json");
    return withPublicMemberPhotoUrls(JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as Member[]);
  } catch {
    return [];
  }
}

async function getMembers(city: string): Promise<Member[]> {
  const local = getMembersLocal(city);
  if (local.length > 0) return local;

  const remote = await fetchRawJson<Member[]>(`site/data/${city}/members.json`);
  return remote ? withPublicMemberPhotoUrls(remote) : [];
}

function getActivityLocal(city: string): Record<string, MemberActivity> {
  try {
    const fp = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "data",
      city,
      "members_activity.json"
    );
    return JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

async function getActivity(city: string): Promise<Record<string, MemberActivity>> {
  const local = getActivityLocal(city);
  if (Object.keys(local).length > 0) return local;

  return (
    (await fetchRawJson<Record<string, MemberActivity>>(
      `site/data/${city}/members_activity.json`
    )) ?? {}
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const members = await getMembers(city);
  const member = members.find((m) => m.seat_number === Number(id));

  if (!member) {
    return { title: `議員詳細 - ${cityName}議会` };
  }

  const partyLabel = member.party ?? member.faction ?? "";
  const title = partyLabel
    ? `${member.name}（${partyLabel}）- ${cityName}議会`
    : `${member.name} - ${cityName}議会`;
  const description = `${cityName}議会 ${member.name}議員の会派、委員会、得票数、活動テーマ、発言記録を掲載しています。`;

  return buildPageMetadata({
    title,
    description,
    path: `/${city}/members/${member.seat_number}`,
  });
}

export default async function CityMemberDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  const members = await getMembers(city);
  const member = members.find((m) => m.seat_number === Number(id));
  if (!member) notFound();

  const activity = await getActivity(city);
  const memberActivity = activity[member.name.replace(/\s/g, "")];
  const questionThemes = memberActivity?.summary_topics ?? [];

  const memberSearchHref = searchHref(city, cityName, member.name);
  const councilName = municipality?.council_name ?? `${cityName}議会`;
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: councilName, path: `/${city}` },
    { name: member.name, path: `/${city}/members/${id}` },
  ]);
  const profilePage = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${member.name} - ${councilName}`,
    description: `${councilName} ${member.name}議員のプロフィールと発言記録ページです。`,
    url: absoluteUrl(`/${city}/members/${id}`),
    mainEntity: {
      "@type": "Person",
      name: member.name,
      alternateName: member.furigana || undefined,
      image: member.photo_url || undefined,
      jobTitle: `${councilName}議員`,
      memberOf: {
        "@type": "GovernmentOrganization",
        name: councilName,
      },
      affiliation: member.faction
        ? {
            "@type": "Organization",
            name: member.faction,
          }
        : undefined,
    },
  };

  return (
    <div className="page-shell max-w-6xl">
      <JsonLd data={[breadcrumb, profilePage]} />
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} prefetch={false} className="inline-flex min-h-11 items-center transition-colors hover:text-[#1B3A6B]">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{member.name}</span>
      </nav>

      {/* プロフィールカード */}
      <section id="profile" className="theme-card mb-4 scroll-mt-20 p-6">
        <div className="flex items-start gap-5">
          {member.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              width={112}
              height={160}
              loading="lazy"
              decoding="async"
              className="h-40 w-28 shrink-0 rounded-[20px] border border-[#E2E8F0] object-cover shadow-sm"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="theme-pill-soft text-[#2A5298]">
                {member.seat_number}番
              </span>
              {memberActivity && (
                <span className="theme-pill-soft text-[#2A5298]">
                  質問記録 {memberActivity.session_count}回
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-[#1A202C] leading-snug">
              {member.name}
            </h1>
            <p className="text-sm text-[#718096] mt-0.5">{member.furigana}</p>
          </div>
        </div>

        <hr className="border-[#E2E8F0] my-4" />

        <dl className="space-y-3">
          {member.party && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                政党
              </dt>
              <dd className="text-sm text-[#1A202C]">{member.party}</dd>
            </div>
          )}
          {member.faction && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                会派
              </dt>
              <dd>
                <span className="theme-pill-soft text-sm text-[#1A202C]">
                  {member.faction}
                </span>
              </dd>
            </div>
          )}
          {member.committees.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                委員会
              </dt>
              <dd className="flex flex-wrap gap-1">
                {member.committees.map((c) => (
                  <span
                    key={c}
                    className="theme-pill-soft text-sm text-[#4A5568]"
                  >
                    {c}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {member.votes && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                得票数
              </dt>
              <dd className="text-sm text-[#1A202C]">
                {member.votes.toLocaleString()}票
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* セクションナビゲーション */}
      <nav
        aria-label="議員ページ内ナビゲーション"
        className="theme-card mb-4 flex gap-1 p-1 text-sm"
      >
        <a
          href="#profile"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 py-2 text-center font-medium text-[#4A5568] transition-colors hover:bg-[#E8EEF7] hover:text-[#1B3A6B]"
        >
          プロフィール
        </a>
        <a
          href="#activity"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 py-2 text-center font-medium text-[#4A5568] transition-colors hover:bg-[#E8EEF7] hover:text-[#1B3A6B]"
        >
          活動記録
        </a>
        <a
          href="#share"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 py-2 text-center font-medium text-[#4A5568] transition-colors hover:bg-[#E8EEF7] hover:text-[#1B3A6B]"
        >
          シェア
        </a>
      </nav>

      {/* シェア・検索セクション */}
      <section id="share" className="mb-5 scroll-mt-20">
        <div className="theme-panel mb-2 flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-[#1B3A6B]">
            <span className="font-semibold">{member.name}</span> 議員の発言を横断検索
          </p>
          <Link
            href={memberSearchHref}
            prefetch={false}
            className="theme-button shrink-0 px-4 py-1.5 text-sm font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            検索
          </Link>
        </div>

        {/* SNS先では議員名刺OG画像が表示される */}
        <MemberShareButtons
          memberName={member.name}
          cityName={cityName}
          factionLabel={member.faction ?? member.party ?? undefined}
          sessionCount={memberActivity?.session_count}
          themes={questionThemes}
        />
      </section>

      {/* 質問活動 */}
      {memberActivity ? (
        <section id="activity" className="scroll-mt-20">
          <h3 className="text-base font-bold text-[#1B3A6B] mb-3">
            質問・質疑の記録
            <span className="ml-2 text-sm font-normal text-[#718096]">
              （{memberActivity.session_count}回）
            </span>
          </h3>

          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-lg border border-[#CBD5E0] bg-white px-4 py-3">
              <p className="text-xs text-[#718096]">公式会議録</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#1B3A6B]">
                {memberActivity.official_session_count ?? memberActivity.session_count}回
              </p>
            </div>
            <div className="rounded-lg border border-[#F1D39A] bg-[#FFF9EC] px-4 py-3">
              <p className="text-xs text-[#78451F]">正式版公開前の動画速報</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#78451F]">
                {memberActivity.preliminary_session_count ?? 0}回
              </p>
            </div>
            <div className="rounded-lg border border-[#CBD5E0] bg-white px-4 py-3">
              <p className="text-xs text-[#718096]">一般質問</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#1B3A6B]">
                {memberActivity.general_question_count ?? 0}回
              </p>
            </div>
            <div className="rounded-lg border border-[#CBD5E0] bg-white px-4 py-3">
              <p className="text-xs text-[#718096]">代表質問</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#1B3A6B]">
                {memberActivity.representative_question_count ?? 0}回
              </p>
            </div>
            <div className="rounded-lg border border-[#CBD5E0] bg-white px-4 py-3">
              <p className="text-xs text-[#718096]">委員会質疑</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#1B3A6B]">
                {memberActivity.committee_question_count ?? 0}回
              </p>
            </div>
            <div className="rounded-lg border border-[#CBD5E0] bg-white px-4 py-3">
              <p className="text-xs text-[#718096]">本会議質疑</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#1B3A6B]">
                {memberActivity.plenary_question_count ?? 0}回
              </p>
            </div>
          </div>

          {(memberActivity.preliminary_session_count ?? 0) > 0 && (
            <p className="mb-4 rounded-lg border border-[#F1D39A] bg-[#FFF9EC] px-4 py-3 text-sm leading-relaxed text-[#5D3A12]">
              「動画会議録速報」は公式動画の字幕を基にした暫定記録です。正式な会議録が公開された後に照合し、公式記録を優先表示します。
            </p>
          )}

          <div className="theme-panel mb-4 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#718096]">
                  よく扱っているテーマ
                </p>
              </div>
              <form action="/search" method="get" className="flex flex-col gap-2 sm:flex-row lg:min-w-[24rem]">
                <input type="hidden" name="city" value={city} />
                <input type="hidden" name="cityName" value={cityName} />
                <label htmlFor="member-activity-search" className="sr-only">
                  {member.name}議員の発言を検索
                </label>
                <input
                  id="member-activity-search"
                  name="q"
                  type="search"
                  defaultValue={member.name}
                  className="theme-input min-h-11 flex-1 px-3 py-2 text-sm"
                />
                <button type="submit" className="theme-button theme-button-accent min-h-11 px-4 text-sm">
                  検索
                </button>
              </form>
            </div>
            {questionThemes.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {questionThemes.map((t) => {
                  return (
                    <Link
                      key={t}
                      href={searchHref(city, cityName, `${member.name} ${t}`)}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center rounded-full border border-[#CBD5E0] bg-white px-3 py-2 text-xs font-semibold text-[#1B3A6B] transition-colors hover:bg-[#1B3A6B] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                    >
                      {t}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-[#CBD5E0] bg-white px-3 py-2 text-sm leading-relaxed text-[#4A5568]">
                AI要約テーマは準備中です。下の各会議の「議事録中の項目を確認」では、原文から抽出した項目を確認できます。
              </div>
            )}
          </div>

          {/* タイムライン */}
          <ol className="relative border-l-2 border-[#E2E8F0] pl-5 ml-2 space-y-6">
            {(() => {
              // 年度グルーピング（新しい順）
              const groups = new Map<string, typeof memberActivity.sessions>();
              for (const s of memberActivity.sessions) {
                const y = activityYear(s);
                const list = groups.get(y) ?? [];
                list.push(s);
                groups.set(y, list);
              }
              const sorted = Array.from(groups.entries()).sort((a, b) =>
                a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0
              );
              const items: React.ReactNode[] = [];
              for (const [year, sessionList] of sorted) {
                items.push(
                  <li key={`year-${year}`} className="relative -ml-2">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[15px] top-1.5 w-3 h-3 rounded-full bg-[#F7C948] border-2 border-white"
                    />
                    <p className="text-xs font-bold text-[#78451F] tracking-wider tabular-nums">
                      {year === "不明" ? "年度不明" : `${year}年`}
                    </p>
                  </li>
                );
                for (let i = 0; i < sessionList.length; i++) {
                  const s = sessionList[i];
                  const sessionThemes = s.summary_topics?.length ? s.summary_topics : [];
                  const itemHref = s.href ?? (s.council_id > 0 ? `/${city}/minutes/${s.council_id}` : "");
                  const isPreliminary = s.source_status === "preliminary";
                  const activityDate = formatActivityDate(s.date);
                  items.push(
                    <li key={s.record_id ?? `${year}-${i}`} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[25px] top-3 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#2A5298]"
                      />
                      <div className="rounded-lg border border-[#CBD5E0] bg-white px-5 py-4">
                        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={isPreliminary
                                ? "rounded-full bg-[#FFF1D6] px-2 py-0.5 text-[11px] font-semibold text-[#78451F]"
                                : "rounded-full bg-[#E8EEF7] px-2 py-0.5 text-[11px] font-semibold text-[#1B3A6B]"
                              }>
                                {s.source_label ?? (isPreliminary ? "動画会議録速報" : "公式会議録")}
                              </span>
                              <span className="rounded-full bg-[#F4F6F9] px-2 py-0.5 text-[11px] font-semibold text-[#4A5568]">
                                {questionKindLabel(s.question_kind)}
                              </span>
                              {activityDate && (
                                <span className="text-xs tabular-nums text-[#718096]">{activityDate}</span>
                              )}
                            </div>
                            <p className="text-sm font-semibold leading-relaxed text-[#1B3A6B]">
                              {s.session}
                            </p>
                            {s.agenda_title
                              && s.agenda_title !== s.session
                              && !["一般質問", "代表質問"].includes(s.agenda_title) && (
                              <p className="mt-1 text-xs leading-relaxed text-[#4A5568]">
                                議題：{s.agenda_title}
                              </p>
                            )}
                          </div>
                          {itemHref && (
                            <Link
                              href={itemHref}
                              prefetch={false}
                              className="inline-flex min-h-11 shrink-0 items-center gap-0.5 text-xs font-semibold text-[#2A5298] transition-colors hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                            >
                              {isPreliminary ? "動画速報を見る" : "公式会議録を見る"}
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-3 h-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </Link>
                          )}
                        </div>
                        {s.overview && (
                          <p className="mb-3 text-sm leading-relaxed text-[#4A5568]">{s.overview}</p>
                        )}
                        {sessionThemes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {sessionThemes.map((t) => (
                              <Link
                                key={t}
                                href={searchHref(city, cityName, `${member.name} ${t}`)}
                                prefetch={false}
                                className="inline-flex min-h-11 items-center rounded-full bg-[#E8EEF7] px-3 py-2 text-xs font-semibold text-[#1B3A6B] transition-colors hover:bg-[#1B3A6B] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                              >
                                {t}
                              </Link>
                            ))}
                          </div>
                        )}
                        {(s.topic_details?.length ?? 0) > 0 && (
                          <div className="mt-3 space-y-2">
                            {s.topic_details?.map((topic) => (
                              <details key={topic.title} className="rounded-md border border-[#D7E0EC] bg-[#F8FAFC] px-3 py-2">
                                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]">
                                  {topic.title}
                                </summary>
                                <div className="pb-2 pt-1">
                                  {topic.summary && (
                                    <p className="text-sm leading-relaxed text-[#4A5568]">{topic.summary}</p>
                                  )}
                                  {(topic.qa?.length ?? 0) > 0 && (
                                    <dl className="mt-3 space-y-3">
                                      {topic.qa?.map((item, qaIndex) => (
                                        <div key={`${topic.title}-${qaIndex}`} className="rounded-md border border-[#E2E8F0] bg-white p-3">
                                          <dt className="text-sm font-semibold leading-relaxed text-[#1B3A6B]">
                                            Q. {item.question}
                                          </dt>
                                          <dd className="mt-2 text-sm leading-relaxed text-[#4A5568]">
                                            A. {item.answer}
                                          </dd>
                                        </div>
                                      ))}
                                    </dl>
                                  )}
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                        {s.topics.length > 0 && (
                          <details className="mt-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                            <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-[#4A5568] hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]">
                              議事録中の項目を確認
                            </summary>
                            <ul className="mt-2 space-y-1.5">
                              {s.topics.map((t) => (
                                <li key={t} className="flex items-start gap-2 text-sm group">
                                  <span
                                    className="text-[#2A5298] shrink-0 mt-0.5"
                                    aria-hidden="true"
                                  >
                                    ·
                                  </span>
                                  <span className="flex-1 text-[#4A5568]">{t}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                }
              }
              return items;
            })()}
          </ol>
        </section>
      ) : (
        <section id="activity" className="scroll-mt-20 bg-[#F4F6F9] rounded-lg p-6 text-center">
          <p className="text-sm text-[#718096]">質問活動データは準備中です</p>
        </section>
      )}
    </div>
  );
}
