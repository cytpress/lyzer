// frontend/lygazsum/src/hooks/useTocObserver.ts

import { TocEntry } from "@/types/models";
import { useEffect, useRef, useState } from "react";

/**
 * 自定義 Hook：觀察目錄(TOC)對應的內容區塊，並回傳當前最活躍的區塊 ID。
 * 用於實現滾動時，目錄項目高亮的效果。
 *
 * @param {TocEntry[]} tocEntries - 從分析結果生成的目錄條目陣列。
 * @returns {string | null} - 當前在可見區域中最活躍的目錄條目 ID，若無則為 null。
 */
export function useTocObserver(tocEntries: TocEntry[]): string | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  useEffect(() => {
    const observerOptions = {
      root: null, // 瀏覽器視窗作為觀察範圍

      // rootMargin 用於調整觀察區域的範圍
      // "-73px" 使得觀察範圍從頂部向下73px，因header有72px高，低於header 1px，避免有時元素剛好卡在72px的位置
      // "-86%" 使觀插範圍從底部向上86%，因部分元素為矮元素、高亮邏輯為最後一個進入觀察區域的項目、避免一直觸發觀察
      // 故將觀察範圍限縮，確保高亮項目盡量是最靠近頂部的項目
      rootMargin: "-73px 0px -86% 0px",
      threshold: 0, // 元素一旦進入觀察區域，即觸發handleIntersection，並且只設定一個門檻，避免多次觸發
    };

    /**
     * IntersectionObserver 的callback function。
     * @param {IntersectionObserverEntry[]} entries - 被觀察的目標元素列表。
     */
    function handleIntersection(entries: IntersectionObserverEntry[]) {
      // 篩選當前正在與觀察區域相交的元素。
      const intersectingEntries = entries.filter(
        (entry) => entry.isIntersecting
      );

      // 如果有相交的元素，則將最後一個進入的元素 ID 設為 active。
      if (intersectingEntries.length > 0) {
        setActiveTocId(
          intersectingEntries[intersectingEntries.length - 1].target.id
        );
      }
    }
    // 如果toc項目存在時，才建立IntersectionObserver
    if (tocEntries && tocEntries.length > 0) {
      const newObserver = new IntersectionObserver(
        handleIntersection,
        observerOptions
      );
      observerRef.current = newObserver;

      //透過遞迴方式，來建立出需要被觀察的 DOM 元素
      function observeEntries(entries: TocEntry[]) {
        entries.forEach((entry) => {
          // 如果 entry 中含有id的屬性，則觀察他
          const elementToObserve = document.getElementById(entry.id);
          if (elementToObserve) {
            newObserver.observe(elementToObserve);
          }

          // 如果 entry 中含有 child 屬性，遞迴觀察他們
          if (entry.children && entry.children.length > 0) {
            observeEntries(entry.children);
          }
        });
      }
      observeEntries(tocEntries);

      // 組件卸載時清理函式
      return () => {
        newObserver.disconnect();
      };
    } else {
      // 如果就算沒有目錄項目，一樣清理觀察者
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      setActiveTocId(null);
    }
  }, [tocEntries]);

  return activeTocId;
}
