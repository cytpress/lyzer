import { DetailedGazetteItem } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import { useParams } from "react-router-dom";
import AgendaItemAnalysisDisplay from "../components/AgendaItemAnalysisDisplay";
import AgendaItemMetadata from "../components/AgendaItemMetadata";
import { DetailedPageTableOfContent } from "../components/DetailedPageTableOfContent";
import generateTocEntries from "../utils/tocUtils";
import { useRef, useState, useEffect, useMemo } from "react";

export default function DetailedGazettePage() {
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const params = useParams<{ id: string }>();
  const gazetteIdFromParams = params.id;
  const { isPending, isError, data, error } = useQuery<
    DetailedGazetteItem | null,
    Error
  >({
    queryKey: ["detailedPageGazette", gazetteIdFromParams],
    queryFn: () => {
      return fetchDetailedGazetteById(gazetteIdFromParams as string);
    },
    enabled: !!gazetteIdFromParams,
  });

  const tocEntries = useMemo(() => {
    if (data && data.analysis_result) {
      return generateTocEntries({ analysisResult: data.analysis_result });
    }
    return [];
  }, [data]);

  // useEffect(() => {
  //   // 只在開發環境下顯示輔助框
  //   if (process.env.NODE_ENV === 'development') {
  //     const viewportHeight = window.innerHeight;
  //     const viewportWidth = window.innerWidth;

  //     const headerHeight = 64; // 你的 Header 高度
  //     const topMargin = headerHeight; // 因為 rootMargin-top 是 -64px，所以有效區域頂部向下 64px
  //     const bottomMarginPercent = 0.75; // rootMargin-bottom 是 -30%

  //     // 計算有效觀察區域的尺寸和位置 (相對於 viewport)
  //     const effectiveTop = topMargin;
  //     const effectiveBottom = viewportHeight * (1 - bottomMarginPercent);
  //     const effectiveHeight = effectiveBottom - effectiveTop;

  //     // 創建一個 div 來表示有效觀察區域
  //     const effectiveAreaBox = document.createElement('div');
  //     effectiveAreaBox.id = 'debug-effective-intersection-area'; // 給個 ID 方便移除
  //     document.body.appendChild(effectiveAreaBox);

  //     // 應用樣式
  //     Object.assign(effectiveAreaBox.style, {
  //       position: 'fixed',
  //       top: `${effectiveTop}px`,
  //       left: '0px', // 假設 rootMargin 左右是 0px
  //       width: `${viewportWidth}px`, // 假設 rootMargin 左右是 0px
  //       height: `${effectiveHeight > 0 ? effectiveHeight : 0}px`, // 高度不能為負
  //       backgroundColor: 'rgba(0, 255, 0, 0.2)', // 半透明綠色
  //       border: '2px dashed limegreen',
  //       zIndex: '9999', // 確保在最上層
  //       pointerEvents: 'none', // 讓鼠標事件穿透，不影響頁面交互
  //       boxSizing: 'border-box',
  //     });

  //     // 當視窗大小改變時，重新計算並更新輔助框
  //     const handleResize = () => {
  //       const newViewportHeight = window.innerHeight;
  //       const newViewportWidth = window.innerWidth;
  //       const newEffectiveTop = topMargin;
  //       const newEffectiveBottom = newViewportHeight * (1 - bottomMarginPercent);
  //       const newEffectiveHeight = newEffectiveBottom - newEffectiveTop;

  //       Object.assign(effectiveAreaBox.style, {
  //         top: `${newEffectiveTop}px`,
  //         left: '0px',
  //         width: `${newViewportWidth}px`,
  //         height: `${newEffectiveHeight > 0 ? newEffectiveHeight : 0}px`,
  //       });
  //     };

  //     window.addEventListener('resize', handleResize);

  //     // 清理函式：組件卸載時移除輔助框和事件監聽
  //     return () => {
  //       const existingBox = document.getElementById('debug-effective-intersection-area');
  //       if (existingBox) {
  //         existingBox.remove();
  //       }
  //       window.removeEventListener('resize', handleResize);
  //     };
  //   }
  // }, []);

  useEffect(() => {
    const prevObserver = observerRef.current;
    if (prevObserver) prevObserver.disconnect();

    const observerOptions = {
      root: null,
      rootMargin: "-64px 0px -75% 0px",
      threshold: [0.1],
    };

    function handleIntersection(entries: IntersectionObserverEntry[]) {
      let highlightedEntry: IntersectionObserverEntry | null = null;

      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (
            !highlightedEntry ||
            entry.boundingClientRect.top <
              highlightedEntry.boundingClientRect.top
          ) {
            highlightedEntry = entry;
            setActiveTocId(highlightedEntry.target.id);
          }
        }
      }
    }

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
  }, [tocEntries]);

  if (isPending && gazetteIdFromParams) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data) return <span>查無公報資料</span>;

  const { summary_title, overall_summary_sentence, agenda_items } =
    data.analysis_result;

  return (
    <div className="flex flex-row lg:gap-x-8 lg:px-8">
      <article className="w-full lg:w-3/4 py-6">
        <h1 className="text-3xl text-slate-900 mb-4">{summary_title}</h1>
        <p className="text-base text-slate-800 mb-6 ">
          {overall_summary_sentence}
        </p>
        <div className="space-y-6">
          {agenda_items?.map((item, itemIndex) => (
            <AgendaItemAnalysisDisplay
              item={item}
              itemIndex={itemIndex}
              key={`agenda-item-${itemIndex}`}
            />
          ))}
          <AgendaItemMetadata metadata={data} />
        </div>
      </article>
      <DetailedPageTableOfContent entries={tocEntries} activeId={activeTocId} />
    </div>
  );
}
