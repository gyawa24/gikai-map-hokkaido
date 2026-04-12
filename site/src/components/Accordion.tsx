"use client";

import { useState } from "react";

type AccordionProps = {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function Accordion({ title, count, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-lg border border-[#CBD5E0] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-3 text-left bg-white hover:bg-[#F4F6F9] hover:text-[#1B3A6B] transition-colors focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:outline-none"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#1B3A6B]">{title}</span>
          {count !== undefined && (
            <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">
              {count}件
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-[#4A5568] shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[#E2E8F0]">
          {children}
        </div>
      )}
    </div>
  );
}
