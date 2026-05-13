import Link from "next/link";
import type { StructuredMinutes, TopicBlock, TopicSnippet, Turn } from "@/lib/structured-minutes/types";
import TurnCard from "./TurnCard";
import QuestionBlockCard from "./QuestionBlockCard";
import TopicBlockCard from "./TopicBlockCard";

type StructuredMinutesView = "turns" | "questions" | "topics";

type StructuredMinutesTabsProps = {
  data: StructuredMinutes;
  view: StructuredMinutesView;
  page: number;
  basePath: string;
};

const TABS: { id: StructuredMinutesView; label: string }[] = [
  { id: "questions", label: "質問者別" },
  { id: "topics", label: "質問項目別" },
  { id: "turns", label: "発言単位" },
];
const PAGE_SIZE = 50;

function tabHref(basePath: string, view: StructuredMinutesView, page = 1): string {
  return `${basePath}?view=${view}&page=${page}`;
}

function isTurn(value: Turn | undefined): value is Turn {
  return Boolean(value);
}

function isTopicSnippet(value: TopicSnippet | undefined): value is TopicSnippet {
  return Boolean(value);
}

export default function StructuredMinutesTabs({
  data,
  view,
  page,
  basePath,
}: StructuredMinutesTabsProps) {
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
  const activeItems =
    view === "turns" ? data.turns : view === "questions" ? data.question_blocks : publicTopicBlocks;
  const totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const displayStart = activeItems.length === 0 ? 0 : startIndex + 1;
  const displayEnd = Math.min(endIndex, activeItems.length);
  const visibleTurns = data.turns.slice(startIndex, endIndex);
  const visibleQuestionBlocks = data.question_blocks.slice(startIndex, endIndex);
  const visibleTopicBlocks = publicTopicBlocks.slice(startIndex, endIndex);
  const viewDescriptions: Record<StructuredMinutesView, string> = {
    questions:
      "公式会議録の流れに沿って、質問者ごとの質問セッションとして整理しています。質問項目名は該当する原文へ移動しやすくするための編集部整理です。",
    topics:
      "長い質問・答弁の中から、質問項目に関係する原文部分を抜粋して並べています。項目名・分類タグは編集部整理、本文は原文抜粋です。",
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
              href={tabHref(basePath, tab.id)}
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
          {activeItems.length}件中 {displayStart}〜{displayEnd}件を表示
        </p>
        {totalPages > 1 && (
          <div className="flex flex-wrap gap-2">
            {currentPage > 1 && (
              <Link
                href={tabHref(basePath, view, currentPage - 1)}
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
                href={tabHref(basePath, view, currentPage + 1)}
                className="rounded-full border border-[#CBD5E0] bg-white px-3 py-1 text-xs font-bold text-[#1B3A6B] hover:bg-[#E8EEF7]"
              >
                次へ
              </Link>
            )}
          </div>
        )}
      </div>

      {view === "turns" && (
        <div className="space-y-4">
          {visibleTurns.map((turn) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              questionBlock={questionBlocksByTurnId.get(turn.id)}
              topicBlocks={topicBlocksByTurnId.get(turn.id)}
              citationTitle={data.source_document.title}
            />
          ))}
        </div>
      )}

      {view === "questions" && (
        <div className="space-y-4">
          {visibleQuestionBlocks.map((block) => (
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

      {view === "topics" && (
        <div className="space-y-4">
          {visibleTopicBlocks.map((topic) => (
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
