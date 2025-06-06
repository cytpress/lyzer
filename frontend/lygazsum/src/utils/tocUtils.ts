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
    const idPrefix = `item-${itemIndex}`;
    if (item.item_title) {
      tocEntries.push({
        id: `${idPrefix}-item-title`,
        text: "議題摘要",
        level: 1,
      });
    }
    if (item.core_issue) {
      tocEntries.push({
        id: `${idPrefix}-core-issues`,
        text: "核心議題",
        level: 1,
      });
    }
    if (item.controversy) {
      tocEntries.push({
        id: `${idPrefix}-controversies`,
        text: "相關爭議",
        level: 1,
      });
    }
    if (item.legislator_speakers) {
      tocEntries.push({
        id: `${idPrefix}-legislators-response`,
        text: "立法委員發言",
        level: 1,
      });
      item.legislator_speakers.forEach((speaker) => {
        if (speaker.speaker_name) {
          tocEntries.push({
            id: `${idPrefix}-${speaker.speaker_name}`,
            text: speaker.speaker_name,
            level: 2,
            isCurrentlyVisible: false,
          });
        }
      });
    }
    if (item.respondent_speakers) {
      tocEntries.push({
        id: `${idPrefix}-respondents-response`,
        text: "相關人員回覆",
        level: 1,
      });
      item.respondent_speakers.forEach((speaker) => {
        if (speaker.speaker_name) {
          tocEntries.push({
            id: `${idPrefix}-${speaker.speaker_name}`,
            text: speaker.speaker_name,
            level: 2,
            isCurrentlyVisible: false,
          });
        }
      });
    }
    if (item.result_status_next) {
      tocEntries.push({
        id: `${idPrefix}-result-next`,
        text: "相關後續",
        level: 1,
      });
    }
  });
  tocEntries.push({
    id: "metadata-table",
    text: "原始數據",
    level: 1,
  });
  return tocEntries;
}
