import { TocEntry } from "./../types/models";
import { useEffect, useRef, useState, useContext } from "react";
import { ScrollContainerContext } from "../App";

export function useTocObserver(tocEntries: TocEntry[]): string | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const scrollContainerRef = useContext(ScrollContainerContext);
  useEffect(() => {
    const observerOptions = {
      root: scrollContainerRef?.current,
      rootMargin: "-64px 0px -85% 0px",
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

      tocEntries.forEach((entry) => {
        const observedElement = document.getElementById(entry.id);
        if (observedElement && observerRef.current) {
          observerRef.current.observe(observedElement);
        }
      });

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
