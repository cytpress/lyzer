import { DetailedGazetteItem, TocEntry } from "../types/models";
import { useQuery } from "@tanstack/react-query";
import { fetchDetailedGazetteById } from "../services/gazetteService";
import { useParams } from "react-router-dom";
import AgendaItemAnalysisDisplay from "../components/AgendaItemAnalysisDisplay";
import AgendaItemMetadata from "../components/AgendaItemMetadata";
import { DetailedPageTableOfContent } from "../components/DetailedPageTableOfContent";

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

  if (isPending && gazetteIdFromParams) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data) return <span>查無公報資料</span>;

  const { summary_title, overall_summary_sentence, agenda_items } =
    data.analysis_result;

  const tocEntries: TocEntry[] = [];
  agenda_items?.forEach((item, itemIndex) => {
    if (item.core_issue) {
      tocEntries.push({
        id: `item-${itemIndex}-core-issues`,
        text: "核心議題",
        level: 1,
      });
    }
    if (item.controversy) {
      tocEntries.push({
        id: `item-${itemIndex}-controversies`,
        text: "相關爭議",
        level: 1,
      });
    }
    if (item.legislator_speakers) {
      tocEntries.push({
        id: `item-${itemIndex}-legislators-response`,
        text: "立法委員發言",
        level: 1,
      });
      item.legislator_speakers.forEach((speaker) => {
        if (speaker.speaker_name) {
          tocEntries.push({
            id: `item-${itemIndex}-${speaker.speaker_name}`,
            text: speaker.speaker_name,
            level: 2,
          });
        }
      });
    }
    if (item.respondent_speakers) {
      tocEntries.push({
        id: `item-${itemIndex}-respondents-response`,
        text: "相關人員回覆",
        level: 1,
      });
      item.respondent_speakers.forEach((speaker) => {
        if (speaker.speaker_name) {
          tocEntries.push({
            id: `item-${itemIndex}-${speaker.speaker_name}`,
            text: speaker.speaker_name,
            level: 2,
          });
        }
      });
    }
    if (item.result_status_next) {
      tocEntries.push({
        id: `item-${itemIndex}-result-next`,
        text: "相關後續",
        level: 1,
      });
    }
    tocEntries.push({
      id: "metadata-table",
      text: "原始資料",
      level: 1,
    });
  });

  return (
    <div className="flex flex-row lg:gap-x-8 lg:px-8">
      <article className="w-full lg:w-3/4">
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
      <DetailedPageTableOfContent entries={tocEntries} />
    </div>
  );
}
