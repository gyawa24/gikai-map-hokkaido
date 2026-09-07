import type { QuestionBlock, TopicBlock, Turn } from "@/lib/structured-minutes/types";
import EvidenceLink from "./EvidenceLink";
import { formatMeetingDate } from "./formatMeetingDate";

type QuestionBlockCardProps = {
  block: QuestionBlock;
  turns: Turn[];
  topicBlocks: TopicBlock[];
};

function turnLabel(turn: Turn): string {
  if (turn.turn_type === "question") return "質問";
  if (turn.turn_type === "answer") return "答弁";
  if (turn.turn_type === "procedure") return "議事進行";
  return "発言";
}

function questionMethodLabel(method: QuestionBlock["question_method"]): string {
  if (method === "comprehensive") return "一括質問一括答弁";
  if (method === "one_by_one") return "一問一答";
  if (method === "mixed") return "混在";
  return "質問方式未確認";
}

function uniqueTitles(titles: string[]): string[] {
  return [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
}

export default function QuestionBlockCard({
  block,
  turns,
  topicBlocks,
}: QuestionBlockCardProps) {
  const agendaTitles = uniqueTitles(block.agenda_titles);

  return (
    <article
      id={block.id}
      className="scroll-mt-24 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[#C5D0E6] bg-[#E8EEF7] px-2 py-0.5 text-xs font-bold text-[#1B3A6B]">
          質問セッション
        </span>
        <span className="text-xs font-medium text-[#718096]">
          {formatMeetingDate(block.meeting_date)}
        </span>
        <h3 className="text-lg font-bold leading-snug text-[#1A202C]">
          {block.questioner_name_original}
        </h3>
        <span className="text-xs text-[#718096]">
          {questionMethodLabel(block.question_method)}
        </span>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[#4A5568]">
        公式会議録上の質問者ごとのまとまりです。下の質問項目名は、原文中の該当箇所へ移動しやすくするために構造化処理で付与した整理情報です。
      </p>

      {agendaTitles.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {agendaTitles.slice(0, 8).map((title) => (
            <span
              key={title}
              className="rounded-full border border-[#E2E8F0] bg-[#F4F6F9] px-2 py-0.5 text-xs text-[#4A5568]"
            >
              {title}
            </span>
          ))}
        </div>
      )}

      {topicBlocks.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold text-[#718096]">質問項目</p>
          <div className="flex flex-wrap gap-2">
            {topicBlocks.map((topic) => (
              <a
                key={topic.id}
                href={`?view=topics#${topic.id}`}
                className="rounded-full border border-[#CBD5E0] bg-white px-3 py-1 text-xs font-bold text-[#1B3A6B] transition-colors hover:bg-[#E8EEF7]"
              >
                {topic.title_original}
              </a>
            ))}
          </div>
        </div>
      )}

      <p className="mb-2 border-t border-[#E2E8F0] pt-4 text-xs font-bold text-[#718096]">
        原文の流れ
      </p>
      <ol className="space-y-2">
        {turns.slice(0, 12).map((turn) => (
          <li key={turn.id} className="flex gap-3 text-sm leading-relaxed">
            <span className="shrink-0 rounded bg-[#F4F6F9] px-2 py-0.5 text-xs font-bold text-[#4A5568]">
              {turnLabel(turn)}
            </span>
            <a href={`?view=turns#${turn.id}`} className="min-w-0 text-[#1A202C] hover:text-[#1B3A6B]">
              <span className="font-bold">{turn.speaker_name_original}</span>
              <span className="ml-2 text-[#718096]">
                {turn.text_original.replace(/\s+/g, " ").slice(0, 90)}
              </span>
            </a>
          </li>
        ))}
      </ol>

      <div className="mt-4">
        <EvidenceLink sourcePosition={block.source_position} />
      </div>
    </article>
  );
}
