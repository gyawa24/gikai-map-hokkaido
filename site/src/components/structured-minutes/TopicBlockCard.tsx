import type {
  SourceDocument,
  TopicBlock,
  TopicSnippet,
  Turn,
} from "@/lib/structured-minutes/types";
import EvidenceLink from "./EvidenceLink";
import CopyCitationButton from "./CopyCitationButton";

type TopicBlockCardProps = {
  topic: TopicBlock;
  snippets: TopicSnippet[];
  turns: Turn[];
  sourceDocument: SourceDocument;
};

function snippetLabel(snippet: TopicSnippet): string {
  const labels: Record<TopicSnippet["snippet_role"], string> = {
    question: "質問",
    answer: "答弁",
    re_question: "再質問",
    re_answer: "再答弁",
    request: "要望",
    context: "文脈",
  };
  return labels[snippet.snippet_role];
}

function snippetRoundLabel(snippet: TopicSnippet): string | null {
  if (snippet.snippet_role === "re_question") return "2回目以降の質問";
  if (snippet.snippet_role === "re_answer") return "2回目以降の答弁";
  if (snippet.snippet_role === "request") return "要望・意見";
  return null;
}

function snippetTone(snippet: TopicSnippet): string {
  if (snippet.snippet_role === "question" || snippet.snippet_role === "re_question") {
    return "border-[#C5D0E6] bg-[#E8EEF7] text-[#1B3A6B]";
  }
  if (snippet.snippet_role === "answer" || snippet.snippet_role === "re_answer") {
    return "border-[#B7DEC9] bg-[#EEF9F2] text-[#166534]";
  }
  return "border-[#E2E8F0] bg-[#F4F6F9] text-[#4A5568]";
}

export default function TopicBlockCard({
  topic,
  snippets,
  turns,
  sourceDocument,
}: TopicBlockCardProps) {
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const respondentNames = [
    ...new Set(
      topic.flow
        .filter((item) => item.role === "answer" || item.role === "re_answer")
        .map((item) => item.speaker_name_original)
        .filter(Boolean)
    ),
  ];

  return (
    <article id={topic.id} className="scroll-mt-24 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[#E6C566] bg-[#FFF7D6] px-2 py-0.5 text-xs font-bold text-[#6B4C11]">
          質問項目
        </span>
        <h3 className="text-lg font-bold leading-snug text-[#1A202C]">
          {topic.title_original}
        </h3>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[#4A5568]">
        この項目名と分類タグは地方議会ドットコム編集部による整理です。下の本文は、公式会議録の発言からこの質問項目に関係する部分を抜き出した原文抜粋です。
      </p>

      <div className="mb-4 flex flex-wrap gap-2 text-xs text-[#4A5568]">
        {topic.policy_area_tags.length > 0 && (
          <span className="rounded border border-[#E2E8F0] bg-[#F4F6F9] px-2 py-0.5 font-bold">
            編集部タグ: {topic.policy_area_tags.join("、")}
          </span>
        )}
        {respondentNames.length > 0 && (
          <span className="rounded border border-[#B7DEC9] bg-[#EEF9F2] px-2 py-0.5 font-bold text-[#166534]">
            答弁者: {respondentNames.join("、")}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {snippets.map((snippet) => {
          const turn = turnsById.get(snippet.turn_id);
          const speakerName = turn?.speaker_name_original ?? "";
          const roundLabel = snippetRoundLabel(snippet);
          const citation = `【原文抜粋】\n${snippet.text_original}\n\n出典:\n${sourceDocument.title}\n${sourceDocument.official_url}\n地方議会ドットコム構造化ID: ${topic.id} / ${snippet.id}`;

          return (
            <section
              key={snippet.id}
              id={snippet.id}
              className="scroll-mt-24 rounded-lg border border-[#E2E8F0] bg-[#FBFCFE] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${snippetTone(snippet)}`}>
                  {snippetLabel(snippet)}
                </span>
                {roundLabel && (
                  <span className="rounded-full border border-[#E2E8F0] bg-white px-2 py-0.5 text-xs font-bold text-[#4A5568]">
                    {roundLabel}
                  </span>
                )}
                <span className="text-sm font-bold text-[#1A202C]">{speakerName}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1A202C]">
                {snippet.text_original}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <EvidenceLink sourcePosition={snippet.source_position} />
                <CopyCitationButton text={citation} />
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-4 border-t border-[#E2E8F0] pt-3">
        <EvidenceLink sourcePosition={topic.source_position} />
      </div>
    </article>
  );
}
