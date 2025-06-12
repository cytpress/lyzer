import { DetailedGazetteItem } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import AgendaItemAnalysisDisplay from "../components/DetailedPageAgendaItemDisplay";
import AgendaItemMetadata from "../components/DetailedPageMetadata";
import { DetailedPageTableOfContent } from "../components/DetailedPageTableOfContent";
import generateTocEntries from "../utils/tocUtils";
import { useTocObserver } from "../hooks/useTocObserver";
import { ListBulletIcon } from "@heroicons/react/24/outline";
import { DetailedPageSkeleton } from "../components/feedback/DetailedPageSkeleton";
import { ErrorDisplay } from "../components/feedback/ErrorDisplay";

export default function DetailedGazettePage() {
  const params = useParams<{ id: string }>();

  const gazetteIdFromParams = params.id;

  const { isPending, isError, data, error, refetch } = useQuery<
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
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [intersectingTargetIds, setIntersectingTargetIds] = useState<string[]>(
    []
  );

  useEffect(() => {
    const observerOptions = {
      rootMargin: "-73px 0px -85% 0px",
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
    <div className="flex flex-row px-6 md:px-20">
      <article className="md:w-2/3 pt-10 md:mr-12">
        <section>
          <h1 className="text-2xl md:text-3xl font-semibold leading-snug mb-3 md:mb-6 text-neutral-900">
            {summary_title}
          </h1>
          <p className="text-base leading-[180%] md:leading-relaxed text-neutral-800 mb-3 md:mb-6 ">
            {overall_summary_sentence}
          </p>
        </section>
        {agenda_items?.map((item, itemIndex) => (
          <React.Fragment key={`agenda-item-wrapper-${itemIndex}`}>
            <AgendaItemAnalysisDisplay
              item={item}
              itemIndex={itemIndex}
              key={`agenda-item-${itemIndex}`}
            />
            {itemIndex < agenda_items.length - 1 && (
              <hr className="my-6 md:my-12 border-t-1 border-neutral-300" />
            )}
          </React.Fragment>
        ))}
        <AgendaItemMetadata metadata={data} />
      </article>
      <DetailedPageTableOfContent
        entries={baseTocEntries}
        activeId={activeTocId}
        expandedGroupIds={intersectingTargetIds}
        isOpen={isTocOpen}
        onClose={() => {
          setIsTocOpen(false);
        }}
      />
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
