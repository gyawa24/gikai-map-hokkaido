"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastTone = "success" | "info";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  show: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * 画面下部にスライドインするトースト通知。
 * useToast().show("コピーしました") のように使う。
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextIdRef.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    // 2.5秒後に自動消去
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastBody key={t.id} tone={t.tone} message={t.message} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastBody({ tone, message }: { tone: ToastTone; message: string }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // 次フレームで class を付けてスライドイン
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toneClass =
    tone === "success"
      ? "bg-[#065F46] text-white"
      : "bg-[#1B3A6B] text-white";

  return (
    <div
      className={`pointer-events-auto rounded-lg shadow-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-all duration-200 ${toneClass} ${
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {tone === "success" && (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span>{message}</span>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Provider がない環境ではフォールバック: 何もしない
    return { show: () => {} };
  }
  return ctx;
}
