type Props = {
  transcript: string;
};

export default function FullTranscriptBlock({ transcript }: Props) {
  return (
    <details className="bg-white rounded-lg border border-[#CBD5E0] overflow-hidden">
      <summary className="cursor-pointer list-none px-5 py-3 flex items-center justify-between text-sm font-medium text-[#1B3A6B] hover:bg-[#F4F6F9]">
        <span>全文文字起こし（Scribe原文）</span>
        <span className="text-xs text-[#718096]">クリックして開く</span>
      </summary>
      <div className="px-5 py-4 border-t border-[#E2E8F0]">
        <p className="text-xs text-[#718096] mb-3">
          自動文字起こしの生テキストです。誤変換や話者混在を含む場合があります。
        </p>
        <pre className="text-sm text-[#4A5568] whitespace-pre-wrap leading-relaxed font-sans">
          {transcript}
        </pre>
      </div>
    </details>
  );
}
