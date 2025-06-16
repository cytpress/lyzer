// frontend/lygazsum/src/hooks/useScrollbarVisibility.ts

import { useEffect, useRef } from "react";

/**
 * 自定義 Hook：在使用者滾動頁面時，短暫地顯示滾動條後，自動隱藏。
 * 主要用於改善在行動裝置上的使用者體驗，預設情況下滾動條是隱藏的。
 *
 * @param {number} [timeout=1500] - 滾動事件停止後，滾動條保持可見的毫秒數。
 */
export function useScrollbarVisibility(timeout: number = 1500) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function handleScroll() {
      // 如果已有計時器在運行，先清除它，避免連續滾動出現問題。
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // 為 <html> 元素添加 'scrollbar-visible' class
      document.documentElement.classList.add("scrollbar-visible");

      // 設定新的計時器，在指定時間後移除 "scrollbar-visible" class，用來隱藏滾動條。
      timerRef.current = window.setTimeout(() => {
        document.documentElement.classList.remove("scrollbar-visible");
      }, timeout);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    // 組件卸載的清理涵式
    return () => {
      window.removeEventListener("scroll", handleScroll);

      // 如果計時器還在的話也清除掉
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [timeout]);
}
