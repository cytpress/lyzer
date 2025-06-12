import { TocEntry } from "./../types/models";
import { useEffect, useRef, useState} from "react";

export function useTocObserver(tocEntries: TocEntry[]): string | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  useEffect(() => {
    const observerOptions = {
      root: window,
      rootMargin: "-73px 0px -86% 0px",
      threshold: 0,
    };

    function handleIntersection(entries: IntersectionObserverEntry[]) {
      const intersectingEntries = entries.filter(
        (entry) => entry.isIntersecting
      );
      if (intersectingEntries.length > 0) {
        setActiveTocId(
          intersectingEntries[intersectingEntries.length - 1].target.id
        );
      }
    }
    if (tocEntries && tocEntries.length > 0) {
      const newObserver = new IntersectionObserver(
        handleIntersection,
        observerOptions
      );
      observerRef.current = newObserver;

      function observeEntries(entries: TocEntry[]) {
        entries.forEach((entry) => {
          const elementToObserve = document.getElementById(entry.id);
          if (elementToObserve) {
            newObserver.observe(elementToObserve);
          }

          if (entry.children && entry.children.length > 0) {
            observeEntries(entry.children);
          }
        });
      }
      observeEntries(tocEntries);

      return () => {
        newObserver.disconnect();
      };
    } else {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      setActiveTocId(null);
    }
  }, [tocEntries, scrollContainerRef]);

  return activeTocId;
}
