import Link from "next/link";
import type { StructuredMinutes, TopicBlock, TopicSnippet, Turn } from "@/lib/structured-minutes/types";
import TurnCard from "./TurnCard";
import QuestionBlockCard from "./QuestionBlockCard";
import TopicBlockCard from "./TopicBlockCard";
import { formatMeetingDate } from "./formatMeetingDate";

type StructuredMinutesView = "turns" | "questions" | "topics";

type StructuredMinutesTabsProps = {
  data: StructuredMinutes;
  view: StructuredMinutesView;
  page: number;
  basePath: string;
  query: string;
};

type SearchField = {
  text: string;
  anchorId: string;
};

type SearchHit<T> = {
  item: T;
  anchorId: string;
  excerpt: string;
};

const TABS: { id: StructuredMinutesView; label: string }[] = [
  { id: "questions", label: "質問者別" },
  { id: "topics", label: "質問項目別" },
  { id: "turns", label: "発言単位" },
];
const PAGE_SIZE = 50;

function tabHref(
  basePath: string,
  view: StructuredMinutesView,
  page = 1,
  query = ""
): string {
  const params = new URLSearchParams({ view, page: String(page) });
  if (query) params.set("q", query);
  return `${basePath}?${params.toString()}`;
}

function isTurn(value: Turn | undefined): value is Turn {
  return Boolean(value);
}

function isTopicSnippet(value: TopicSnippet | undefined): value is TopicSnippet {
  return Boolean(value);
}

function searchTokens(query: string): string[] {
  return query
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedSearchText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, " ");
}

function searchFields(anchorId: string, ...values: (string | string[] | undefined)[]): SearchField[] {
  return values.flatMap((value) => {
    const texts = Array.isArray(value) ? value : [value];
    return texts
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text))
      .map((text) => ({ text, anchorId }));
  });
}

function excerptForField(field: SearchField, tokens: string[]): string {
  const text = field.text.replace(/\s+/g, " ").trim();
  const normalized = normalizedSearchText(text);
  const positions = tokens
    .map((token) => normalized.indexOf(token))
    .filter((position) => position >= 0);
  const firstPosition = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, firstPosition - 35);
  const end = Math.min(text.length, start + 120);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function searchHit<T>(
  item: T,
  fallbackAnchorId: string,
  fields: SearchField[],
  tokens: string[]
): SearchHit<T> | null {
  if (tokens.length === 0) {
    return { item, anchorId: fallbackAnchorId, excerpt: "" };
  }

  const normalizedFields = fields.map((field) => ({
    ...field,
    normalized: normalizedSearchText(field.text),
  }));
  const combined = normalizedFields.map((field) => field.normalized).join("\n");
  if (!tokens.every((token) => combined.includes(token))) return null;

  const bestField = normalizedFields.reduce((best, field) => {
    const score = tokens.filter((token) => field.normalized.includes(token)).length;
    return score > best.score ? { field, score } : best;
  }, { field: normalizedFields[0], score: -1 });

  return {
    item,
    anchorId: bestField.field?.anchorId ?? fallbackAnchorId,
    excerpt: bestField.field ? excerptForField(bestField.field, tokens) : "",
  };
}

function SearchResultLink({
  anchorId,
  label,
  excerpt,
  meetingDate,
}: {
  anchorId: string;
  label: string;
  excerpt: string;
  meetingDate?: string;
}) {
  return (
    <a
      href={`#${anchorId}`}
      className="block rounded-lg border border-[#C5D0E6] bg-white px-3 py-2 transition-colors hover:border-[#8AA3CF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
    >
      {meetingDate && (
        <span className="block text-xs font-medium text-[#718096]">
          {formatMeetingDate(meetingDate)}
        </span>
      )}
      <span className="block text-sm font-bold text-[#1B3A6B]">{label}</span>
      <span className="mt-0.5 block text-sm leading-relaxed text-[#4A5568]">
        {excerpt}
      </span>
    </a>
  );
}

export default function StructuredMinutesTabs({
  data,
  view,
  page,
  basePath,
  query,
}: StructuredMinutesTabsProps) {
  const tokens = searchTokens(query);
  const turnsById = new Map(data.turns.map((turn) => [turn.id, turn]));
  const questionBlocksByTurnId = new Map(
    data.question_blocks.flatMap((block) => block.turn_ids.map((turnId) => [turnId, block] as const))
  );
  const publicTopicBlocks = data.topic_blocks.filter((topic) => topic.public_visible);
  const topicBlocksById = new Map(data.topic_blocks.map((topic) => [topic.id, topic]));
  const topicSnippetsById = new Map(data.topic_snippets.map((snippet) => [snippet.id, snippet]));
  const topicBlocksByTurnId = new Map<string, TopicBlock[]>();
  for (const topic of publicTopicBlocks) {
    for (const turnId of topic.related_turn_ids) {
      const items = topicBlocksByTurnId.get(turnId) ?? [];
      items.push(topic);
      topicBlocksByTurnId.set(turnId, items);
    }
  }
  const snippetsByTopicId = new Map(
    publicTopicBlocks.map((topic) => [
      topic.id,
      topic.topic_snippet_ids
        .map((snippetId) => topicSnippetsById.get(snippetId))
        .filter(isTopicSnippet)
        .sort((a, b) => a.order_index - b.order_index),
    ])
  );
  const snippetsByTurnId = new Map<string, TopicSnippet[]>();
  for (const topic of publicTopicBlocks) {
    for (const snippet of snippetsByTopicId.get(topic.id) ?? []) {
      const snippets = snippetsByTurnId.get(snippet.turn_id) ?? [];
      snippets.push(snippet);
      snippetsByTurnId.set(snippet.turn_id, snippets);
    }
  }

  const turnHits = data.turns.flatMap((turn) => {
    const questionBlock = questionBlocksByTurnId.get(turn.id);
    const topics = topicBlocksByTurnId.get(turn.id) ?? [];
    const fields = [
      ...searchFields(
        turn.id,
        turn.speaker_name_original,
        turn.speaker_name_normalized,
        turn.speaker_role_original,
        turn.agenda_title,
        turn.text_original,
        turn.text_normalized,
        questionBlock?.questioner_name_original,
        questionBlock?.questioner_name_normalized,
        questionBlock?.title_original,
        questionBlock?.agenda_titles
      ),
      ...topics.flatMap((topic) =>
        searchFields(
          turn.id,
          topic.title_original,
          topic.title_normalized,
          topic.parent_topic_title,
          topic.policy_area_tags,
          topic.topic_tags
        )
      ),
      ...(snippetsByTurnId.get(turn.id) ?? []).flatMap((snippet) =>
        searchFields(turn.id, snippet.text_original)
      ),
    ];
    const hit = searchHit(turn, turn.id, fields, tokens);
    return hit ? [hit] : [];
  });

  const questionHits = data.question_blocks.flatMap((block) => {
    const turns = block.turn_ids.map((turnId) => turnsById.get(turnId)).filter(isTurn);
    const topics = block.topic_block_ids
      .map((topicId) => topicBlocksById.get(topicId))
      .filter((topic): topic is TopicBlock => Boolean(topic?.public_visible));
    const snippets = topics.flatMap((topic) => snippetsByTopicId.get(topic.id) ?? []);
    const fields = [
      ...searchFields(
        block.id,
        block.questioner_name_original,
        block.questioner_name_normalized,
        block.title_original,
        block.agenda_titles
      ),
      ...turns.flatMap((turn) =>
        searchFields(
          block.id,
          turn.speaker_name_original,
          turn.speaker_name_normalized,
          turn.speaker_role_original,
          turn.agenda_title,
          turn.text_original,
          turn.text_normalized
        )
      ),
      ...topics.flatMap((topic) =>
        searchFields(
          block.id,
          topic.title_original,
          topic.title_normalized,
          topic.parent_topic_title,
          topic.policy_area_tags,
          topic.topic_tags
        )
      ),
      ...snippets.flatMap((snippet) => searchFields(block.id, snippet.text_original)),
    ];
    const hit = searchHit(block, block.id, fields, tokens);
    return hit ? [hit] : [];
  });

  const topicHits = publicTopicBlocks.flatMap((topic) => {
    const snippets = snippetsByTopicId.get(topic.id) ?? [];
    const fields = [
      ...searchFields(
        topic.id,
        topic.title_original,
        topic.title_normalized,
        topic.parent_topic_title,
        topic.policy_area_tags,
        topic.topic_tags,
        topic.flow.flatMap((item) => [item.speaker_name_original, item.label])
      ),
      ...snippets.flatMap((snippet) => searchFields(snippet.id, snippet.text_original)),
    ];
    const hit = searchHit(topic, topic.id, fields, tokens);
    return hit ? [hit] : [];
  });

  const activeItemCount =
    view === "turns" ? turnHits.length : view === "questions" ? questionHits.length : topicHits.length;
  const totalPages = Math.max(1, Math.ceil(activeItemCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const displayStart = activeItemCount === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(endIndex, activeItemCount);
  const visibleTurnHits = turnHits.slice(startIndex, endIndex);
  const visibleQuestionHits = questionHits.slice(startIndex, endIndex);
  const visibleTopicHits = topicHits.slice(startIndex, endIndex);
  const viewDescriptions: Record<StructuredMinutesView, string> = {
    questions:
      "公式会議録の流れに沿って、質問者ごとの質問セッションとして整理しています。質問項目名は構造化処理で付与した整理情報で、各項目に確認状況を表示しています。",
    topics:
      "長い質問・答弁の中から、質問項目に関係する原文部分を抜粋して並べています。項目名・分類タグは構造化処理による整理情報、本文は原文抜粋です。",
    turns:
      "公式会議録を発言単位に分けて時系列で表示しています。本文は原文をそのまま表示しています。",
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-[#CBD5E0] pb-3">
        {TABS.map((tab) => {
          const active = tab.id === view;
          return (
            <Link
              key={tab.id}
              href={tabHref(basePath, tab.id, 1, query)}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                active
                  ? "border-[#1B3A6B] bg-[#1B3A6B] text-white"
                  : "border-[#CBD5E0] bg-white text-[#1B3A6B] hover:bg-[#E8EEF7]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-[#FBFCFE] px-4 py-3 text-sm leading-relaxed text-[#4A5568]">
        {viewDescriptions[view]}
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-sm text-[#4A5568] sm:flex-row sm:items-center sm:justify-between">
        <p>
          {query ? (
            <>
              「<span className="font-bold text-[#1A202C]">{query}</span>」の検索結果: {activeItemCount}件
              {activeItemCount > 0 && `（${displayStart}〜${displayEnd}件を表示）`}
            </>
          ) : (
            <>
              {activeItemCount}件中 {displayStart}〜{displayEnd}件を表示
            </>
          )}
        </p>
        {totalPages > 1 && (
          <div className="flex flex-wrap gap-2">
            {currentPage > 1 && (
              <Link
                href={tabHref(basePath, view, currentPage - 1, query)}
                className="rounded-full border border-[#CBD5E0] bg-white px-3 py-1 text-xs font-bold text-[#1B3A6B] hover:bg-[#E8EEF7]"
              >
                前へ
              </Link>
            )}
            <span className="rounded-full border border-[#E2E8F0] bg-[#F4F6F9] px-3 py-1 text-xs font-bold text-[#4A5568]">
              {currentPage} / {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link
                href={tabHref(basePath, view, currentPage + 1, query)}
                className="rounded-full border border-[#CBD5E0] bg-white px-3 py-1 text-xs font-bold text-[#1B3A6B] hover:bg-[#E8EEF7]"
              >
                次へ
              </Link>
            )}
          </div>
        )}
      </div>

      {query && activeItemCount > 0 && (
        <nav
          aria-label="このページの検索結果"
          className="mb-4 rounded-lg border border-[#C5D0E6] bg-[#E8EEF7] p-4"
        >
          <p className="mb-2 text-sm font-bold text-[#1B3A6B]">
            このページの検索結果へ移動
          </p>
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {view === "turns" &&
              visibleTurnHits.map((hit) => (
                <li key={hit.item.id}>
                  <SearchResultLink
                    anchorId={hit.anchorId}
                    label={hit.item.speaker_name_original}
                    excerpt={hit.excerpt}
                    meetingDate={hit.item.meeting_date}
                  />
                </li>
              ))}
            {view === "questions" &&
              visibleQuestionHits.map((hit) => (
                <li key={hit.item.id}>
                  <SearchResultLink
                    anchorId={hit.anchorId}
                    label={
                      hit.item.title_original ?? `${hit.item.questioner_name_original}の質問`
                    }
                    excerpt={hit.excerpt}
                    meetingDate={hit.item.meeting_date}
                  />
                </li>
              ))}
            {view === "topics" &&
              visibleTopicHits.map((hit) => (
                <li key={hit.item.id}>
                  <SearchResultLink
                    anchorId={hit.anchorId}
                    label={hit.item.title_original}
                    excerpt={hit.excerpt}
                  />
                </li>
              ))}
          </ul>
        </nav>
      )}

      {query && activeItemCount === 0 && (
        <div
          role="status"
          className="rounded-lg border border-dashed border-[#CBD5E0] bg-white px-5 py-8 text-center"
        >
          <p className="text-base font-bold text-[#1A202C]">一致する項目はありません</p>
          <p className="mt-2 text-sm leading-relaxed text-[#718096]">
            表記を短くするか、別の語句で検索してください。
          </p>
        </div>
      )}

      {view === "turns" && activeItemCount > 0 && (
        <div className="space-y-4">
          {visibleTurnHits.map(({ item: turn }) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              questionBlock={questionBlocksByTurnId.get(turn.id)}
              topicBlocks={topicBlocksByTurnId.get(turn.id)}
              citationTitle={data.source_document.title}
              expandLongText={Boolean(query)}
            />
          ))}
        </div>
      )}

      {view === "questions" && activeItemCount > 0 && (
        <div className="space-y-4">
          {visibleQuestionHits.map(({ item: block }) => (
            <QuestionBlockCard
              key={block.id}
              block={block}
              turns={block.turn_ids.map((turnId) => turnsById.get(turnId)).filter(isTurn)}
              topicBlocks={block.topic_block_ids
                .map((topicId) => topicBlocksById.get(topicId))
                .filter((topic): topic is TopicBlock => Boolean(topic?.public_visible))}
            />
          ))}
        </div>
      )}

      {view === "topics" && activeItemCount > 0 && (
        <div className="space-y-4">
          {visibleTopicHits.map(({ item: topic }) => (
            <TopicBlockCard
              key={topic.id}
              topic={topic}
              snippets={snippetsByTopicId.get(topic.id) ?? []}
              turns={data.turns}
              sourceDocument={data.source_document}
            />
          ))}
        </div>
      )}
    </section>
  );
}
