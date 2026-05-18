"use client";

import { useEffect } from "react";

const HIGHLIGHT_CLASS = "target-highlight-active";

export default function HashTargetScroller() {
  useEffect(() => {
    const timers = new Set<number>();

    const scrollToHash = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (!targetId) return;

      let attempts = 0;
      const run = () => {
        const target = document.getElementById(targetId);
        if (target) {
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({
            block: "center",
            behavior: reduceMotion ? "auto" : "smooth",
          });
          target.classList.remove(HIGHLIGHT_CLASS);
          void target.offsetWidth;
          target.classList.add(HIGHLIGHT_CLASS);
          const cleanup = window.setTimeout(() => {
            target.classList.remove(HIGHLIGHT_CLASS);
            timers.delete(cleanup);
          }, 1900);
          timers.add(cleanup);
          return;
        }

        if (attempts < 20) {
          attempts += 1;
          const retry = window.setTimeout(run, 100);
          timers.add(retry);
        }
      };

      run();
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      window.removeEventListener("hashchange", scrollToHash);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}
