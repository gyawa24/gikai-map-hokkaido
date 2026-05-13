import type { QuestionBlock, TopicBlock, Turn } from "@/lib/structured-minutes/types";
import EvidenceLink from "./EvidenceLink";
import CopyCitationButton from "./CopyCitationButton";

type TurnCardProps = {
  turn: Turn;
  questionBlock?: QuestionBlock;
  topicBlocks?: TopicBlock[];
  citationTitle?: string;
};

function turnTypeLabel(turn: Turn): string {
  const labels: Record<Turn["turn_type"], string> = {
    question: "質問",
    answer: "答弁",
    re_question: "再質問",
    re_answer: "再答弁",
    request: "要望",
    procedure: "議事進行",
    report: "報告",
    debate: "討論",
    vote: "採決",
    other: "その他",
    unknown: "不明",
  };
  return labels[turn.turn_type];
}

function speakerTypeLabel(turn: Turn): string {
  const labels: Record<Turn["speaker_type"], string> = {
    council_member: "議員",
    chair: "議長",
    mayor: "市長",
    vice_mayor: "副市長",
    executive: "市側",
    education_board: "教育委員会",
    office_staff: "事務局",
    committee_chair: "委員長",
    interjection: "発言",
    unknown: "不明",
  };
  return labels[turn.speaker_type];
}

function toneClass(turn: Turn): string {
  if (turn.turn_type === "question" || turn.turn_type === "re_question") {
    return "border-[#C5D0E6] bg-[#E8EEF7] text-[#1B3A6B]";
  }
  if (turn.turn_type === "answer" || turn.turn_type === "re_answer") {
    return "border-[#B7DEC9] bg-[#EEF9F2] text-[#166534]";
  }
  return "border-[#E2E8F0] bg-[#F4F6F9] text-[#4A5568]";
}

export default function TurnCard({
  turn,
  questionBlock,
  topicBlocks = [],
  citationTitle = "",
}: TurnCardProps) {
  const body = (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1A202C]">
      {turn.text_original}
    </p>
  );
  const citation = `【原文抜粋】\n${turn.text_original}\n\n出典:\n${citationTitle}\n${turn.source_position.official_url}\n地方議会ドットコム構造化ID: ${turn.id}`;

  return (
    <article id={turn.id} className="scroll-mt-24 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${toneClass(turn)}`}>
          {turnTypeLabel(turn)}
        </span>
        <h3 className="text-lg font-bold leading-snug text-[#1A202C]">
          {turn.speaker_name_original}
        </h3>
        <span className="text-sm text-[#718096]">{speakerTypeLabel(turn)}</span>
        {turn.speaker_role_original && (
          <span className="text-sm text-[#718096]">{turn.speaker_role_original}</span>
        )}
      </div>

      {questionBlock && (
        <p className="mb-2 text-xs font-medium text-[#718096]">
          質問者別ブロック: {questionBlock.questioner_name_original}
        </p>
      )}
      {topicBlocks.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {topicBlocks.slice(0, 4).map((topic) => (
            <span
              key={topic.id}
              className="rounded-full border border-[#E2E8F0] bg-[#F4F6F9] px-2 py-0.5 text-xs text-[#4A5568]"
            >
              {topic.title_original}
            </span>
          ))}
        </div>
      )}

      {turn.text_original.length > 900 ? (
        <details>
          <summary className="mb-3 cursor-pointer text-sm font-bold text-[#1B3A6B]">
            原文を開く
          </summary>
          {body}
        </details>
      ) : (
        body
      )}

      <div className="mt-4 flex flex-col gap-2">
        <EvidenceLink sourcePosition={turn.source_position} />
        <CopyCitationButton text={citation} />
      </div>
    </article>
  );
}
