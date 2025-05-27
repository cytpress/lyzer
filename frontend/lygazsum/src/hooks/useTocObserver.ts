import { TocEntry } from "./../types/models";
import { useEffect, useRef, useState } from "react";

export function useTocObserver(tocEntries: TocEntry[]): string | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  useEffect(() => {
    const prevObserver = observerRef.current;
    if (prevObserver) prevObserver.disconnect();

    const observerOptions = {
      root: null,
      rootMargin: "-64px 0px -87% 0px",
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
  }, [tocEntries]);

  return activeTocId;
}
