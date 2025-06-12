// frontend/lygazsum/src/hooks/useScrollbarVisibility.ts

import { useEffect, useRef } from "react";

/**
 *
 * @param {number} timeout 
 */

export function useScrollbarVisibility(timeout = 1500) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      document.documentElement.classList.add("scrollbar-visible");

      timerRef.current = window.setTimeout(() => {
        document.documentElement.classList.remove("scrollbar-visible");
      }, timeout);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [timeout]); 
}