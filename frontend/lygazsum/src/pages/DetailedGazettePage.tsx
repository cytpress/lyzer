import { DetailedGazetteItem } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import AgendaItemAnalysisDisplay from "../components/DetailedPageAgendaItemDisplay";
import AgendaItemMetadata from "../components/DetailedPageMetadata";
import { DetailedPageTableOfContent } from "../components/DetailedPageTableOfContent";
import generateTocEntries from "../utils/tocUtils";
import { useTocObserver } from "../hooks/useTocObserver";

export default function DetailedGazettePage() {
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

  const baseTocEntries = useMemo(() => {
    if (data && data.analysis_result) {
      return generateTocEntries({ analysisResult: data.analysis_result });
    }
    return [];
  }, [data]);

  const activeTocId = useTocObserver(baseTocEntries);
  const [intersectingTargetIds, setIntersectingTargetIds] = useState<string[]>(
    []
  );

  useEffect(() => {
    const observerOptions = {
      rootMargin: "-64px 0px -85% 0px",
      threshold: 0,
    };

    function handleIntersection(entries: IntersectionObserverEntry[]) {
      setIntersectingTargetIds((prevIds) => {
        const newIdsSet = new Set(prevIds);
        entries.forEach((entry) => {
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

  if (isPending && gazetteIdFromParams) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data) return <span>查無公報資料</span>;

  const { summary_title, overall_summary_sentence, agenda_items } =
    data.analysis_result;

  return (
    <div className="flex flex-row">
      <article className="w-full lg:w-2/3 pt-10 mr-16">
        <h1 className="text-3xl font-semibold mb-6 text-neutral-900">
          {summary_title}
        </h1>
        <p className="text-base leading-relaxed text-neutral-800 mb-6 ">
          {overall_summary_sentence}
        </p>
        {agenda_items?.map((item, itemIndex) => (
          <AgendaItemAnalysisDisplay
            item={item}
            itemIndex={itemIndex}
            key={`agenda-item-${itemIndex}`}
          />
        ))}
        <AgendaItemMetadata metadata={data} />
      </article>
      <DetailedPageTableOfContent
        entries={baseTocEntries}
        activeId={activeTocId}
        expandedGroupIds={intersectingTargetIds}
      />
    </div>
  );
}
