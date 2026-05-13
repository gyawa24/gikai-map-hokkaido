"use client";

import { useState } from "react";

type CopyCitationButtonProps = {
  text: string;
};

export default function CopyCitationButton({ text }: CopyCitationButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex rounded-full border border-[#CBD5E0] bg-white px-3 py-1 text-xs font-bold text-[#4A5568] transition-colors hover:bg-[#F4F6F9]"
    >
      {copied ? "コピーしました" : "引用をコピー"}
    </button>
  );
}
