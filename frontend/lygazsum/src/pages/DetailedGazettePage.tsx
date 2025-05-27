import { DetailedGazetteItem } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import { useParams } from "react-router-dom";
import AgendaItemAnalysisDisplay from "../components/AgendaItemAnalysisDisplay";
import AgendaItemMetadata from "../components/AgendaItemMetadata";
import { DetailedPageTableOfContent } from "../components/DetailedPageTableOfContent";
import generateTocEntries from "../utils/tocUtils";
import { useTocObserver } from "../hooks/useTocObserver";
import { useMemo } from "react";

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

  const tocEntries = useMemo(() => {
    if (data && data.analysis_result) {
      return generateTocEntries({ analysisResult: data.analysis_result });
    }
    return [];
  }, [data]);

  const activeTocId = useTocObserver(tocEntries);

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
