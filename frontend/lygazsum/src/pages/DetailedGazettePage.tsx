import { DetailedGazetteItem } from "@/types/models";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { fetchDetailedGazetteById } from "@/services/gazetteService";
import AgendaItemAnalysisDisplay from "@/components/DetailedPageAgendaItemDisplay";
import AgendaItemMetadata from "@/components/DetailedPageMetadata";
import { DetailedPageTableOfContent } from "@/components/DetailedPageTableOfContent";
import generateTocEntries from "@/utils/tocUtils";
import { useTocObserver } from "@/hooks/useTocObserver";
import { ListBulletIcon } from "@heroicons/react/24/outline";
import { DetailedPageSkeleton } from "@/components/feedback/DetailedPageSkeleton";
import { ErrorDisplay } from "@/components/feedback/ErrorDisplay";

/**
 * 詳細內容頁面
 * 根據 URL 中的 ID，獲取並展示公報摘要的完整內容。
 */
export default function DetailedGazettePage() {
  const params = useParams<{ id: string }>();

  const gazetteIdFromParams = params.id;

  const location = useLocation();

  const { isPending, isError, data, error, refetch } = useQuery<
    DetailedGazetteItem | null,
    Error
  >({
    queryKey: ["detailedPageGazette", gazetteIdFromParams],
    queryFn: () => {
      // 確保 id 存在
      if (!gazetteIdFromParams) return Promise.resolve(null);
      return fetchDetailedGazetteById(gazetteIdFromParams);
    },
    enabled: !!gazetteIdFromParams,
  });

  // 使用 useMemo 來緩存目錄(TOC)的生成結果，也是為了讓 generateTocEntries 能先使用 data.analysis_result
  const baseTocEntries = useMemo(() => {
    if (data && data.analysis_result) {
      return generateTocEntries({ analysisResult: data.analysis_result });
    }
    return [];
  }, [data]);

  // 確保高亮 toc 項目用狀態
  const activeTocId = useTocObserver(baseTocEntries);

  // 手機版側邊 toc 開始使用
  const [isTocOpen, setIsTocOpen] = useState(false);

  // 用於觀察立法人員回覆、相關人員回覆的兩項是否正在相交
  const [intersectingTargetIds, setIntersectingTargetIds] = useState<string[]>(
    []
  );

  // 分享特定章節連結 URL 時，可直接跳轉至該章節位置
  useEffect(() => {
    // 確保數據已載入且 URL 中有 hash
    if (!isPending && location.hash) {
      try {
        // 從 hash 中提取 ID (移除 '#' 符號)
        const idFromHash = location.hash.substring(1);

        // 對從 URL hash 中獲取的 ID 進行解碼，以處理中文字符或特殊符號。
        const decodedId = decodeURIComponent(idFromHash);

        // 使用一個微小的延遲來確保 DOM 渲染完成
        setTimeout(() => {
          const element = document.getElementById(decodedId);
          if (element) {
            element.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }, 100);
      } catch (e) {
        // 如果 URL 的 hash 格式不正確，decodeURIComponent 可能會拋出錯誤
        console.error(
          "Failed to decode URI component from hash:",
          location.hash,
          e
        );
      }
    }
  }, [isPending, location.hash, data]);

  // 這個 useEffect 用於觀察 "立法委員發言" 及 "相關人員回覆" 區塊，以決定是否展開其子項目
  useEffect(() => {
    // 觀察區域選項與理由與 useTocObserver 相同，不多敘述
    const observerOptions = {
      rootMargin: "-73px 0px -85% 0px",
      threshold: 0,
    };

    /**
     * @param {IntersectionObserverEntry[]} entries - 被觀察的目標元素列表。
     */
    function handleIntersection(entries: IntersectionObserverEntry[]) {
      setIntersectingTargetIds((prevIds) => {
        // 使用 Set 處理 ID 的增減，避免重複。
        const newIdsSet = new Set(prevIds);
        entries.forEach((entry) => {
          // 從被觀察元素的 `data-` 屬性中獲取我們自定義的目標 ID，目前僅在立法委員發言和相關人員回覆的 section 有data-toc-observer-target。
          const targetId = (entry.target as HTMLElement).dataset
            .tocObserverTarget;
          if (targetId) {
            if (entry.isIntersecting) {
              newIdsSet.add(targetId);
            } else {
              newIdsSet.delete(targetId);
            }
          }
        });
        return Array.from(newIdsSet);
      });
    }

    const tocSectionObserver = new IntersectionObserver(
      handleIntersection,
      observerOptions
    );

    const sectionsTargetsToObserved = document.querySelectorAll(
      "[data-toc-observer-target]"
    );

    sectionsTargetsToObserved.forEach((sectionTarget) => {
      tocSectionObserver.observe(sectionTarget);
    });

    return () => {
      tocSectionObserver.disconnect();
    };
  }, [baseTocEntries]);

  if (isPending && gazetteIdFromParams) {
    return <DetailedPageSkeleton />;
  }

  if (isError) {
    return <ErrorDisplay errorMessage={error.message} onRetry={refetch} />;
  }
  if (!data) return <span>查無公報資料</span>;

  const { summary_title, overall_summary_sentence, agenda_items } =
    data.analysis_result;

  return (
    <div className="flex px-6 md:px-20">
      <article className="md:w-2/3 pt-10 md:mr-12">
        {/* 標題與會議簡述 */}
        <section>
          <h1 className="text-2xl md:text-3xl font-semibold leading-snug mb-3 md:mb-6 text-neutral-900">
            {summary_title}
          </h1>
          <p className="text-base leading-[180%] md:leading-relaxed text-neutral-800 mb-3 md:mb-6 ">
            {overall_summary_sentence}
          </p>
        </section>
        {/* 遍歷所有的議程項目，即一項場會議可能有多個討論事項 */}
        {agenda_items?.map((item, itemIndex) => (
          <React.Fragment key={`agenda-item-wrapper-${itemIndex}`}>
            <AgendaItemAnalysisDisplay
              item={item}
              itemIndex={itemIndex}
              key={`agenda-item-${itemIndex}`}
            />
            {/* 若不是最後一個項目，則新增一條分隔線 */}
            {itemIndex < agenda_items.length - 1 && (
              <hr className="my-6 md:my-12 border-t-1 border-neutral-300" />
            )}
          </React.Fragment>
        ))}
        {/* 原始數據表格 */}
        <AgendaItemMetadata metadata={data} />
      </article>
      {/* 詳細頁面的 toc */}
      <DetailedPageTableOfContent
        entries={baseTocEntries}
        activeId={activeTocId}
        expandedGroupIds={intersectingTargetIds}
        isOpen={isTocOpen}
        onClose={() => {
          setIsTocOpen(false);
        }}
      />
      {/* 手機版中的 toc 懸浮按鈕 */}
      <button
        onClick={() => {
          setIsTocOpen(true);
        }}
        className=" md:hidden fixed top-32 right-0 p-2 border border-r-0 rounded-l-md border-neutral-300 bg-neutral-50 text-neutral-700 z-40"
      >
        <ListBulletIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
