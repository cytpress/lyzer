import { TocEntry } from "../types/models";
import { AnalysisResultJson } from "../types/analysisTypes";

interface GenerateTocEntriesParams {
  analysisResult: AnalysisResultJson;
}

export default function generateTocEntries({
  analysisResult,
}: GenerateTocEntriesParams): TocEntry[] {
  if (!analysisResult) return [];

  const { agenda_items } = analysisResult;
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
      text: "原始數據",
      level: 1,
    });
  });
  return tocEntries;
}
