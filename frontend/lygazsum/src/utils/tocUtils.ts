import { TocEntry } from "@/types/models";
import { AnalysisResultJson } from "@/types/analysisTypes";
import { slugify } from "@/utils/slugify";

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
        type: "entry",
      });
    }
    if (item.core_issue) {
      tocEntries.push({
        id: `${idPrefix}-core-issues`,
        text: "核心議題",
        level: 1,
        type: "entry",
      });
    }
    if (item.controversy) {
      tocEntries.push({
        id: `${idPrefix}-controversies`,
        text: "相關爭議",
        level: 1,
        type: "entry",
      });
    }
    if (item.legislator_speakers && item.legislator_speakers.length > 0) {
      const legislatorsTocChildren: TocEntry[] = item.legislator_speakers.map(
        (speaker) => {
          return {
            id: `${idPrefix}-speaker-${slugify(speaker.speaker_name!)}`,
            text: speaker.speaker_name!,
            level: 2,
            type: "entry",
          };
        }
      );
      tocEntries.push({
        id: `${idPrefix}-legislators-speech`,
        text: "立法委員發言",
        level: 1,
        children: legislatorsTocChildren,
        type: "entry",
      });
    }
    if (item.respondent_speakers && item.respondent_speakers.length > 0) {
      const respondentsTocChildren: TocEntry[] = item.respondent_speakers.map(
        (speaker) => {
          return {
            id: `${idPrefix}-speaker-${slugify(speaker.speaker_name!)}`,
            text: speaker.speaker_name!,
            level: 2,
            type: "entry",
          };
        }
      );
      tocEntries.push({
        id: `${idPrefix}-respondents-response`,
        text: "相關人員回覆",
        level: 1,
        children: respondentsTocChildren,
        type: "entry",
      });
    }
    if (item.result_status_next) {
      tocEntries.push({
        id: `${idPrefix}-result-next`,
        text: "相關後續",
        level: 1,
        type: "entry",
      });
    }
    const isLastItem = itemIndex === agenda_items.length - 1;
    if (!isLastItem) {
      tocEntries.push({
        id: `${idPrefix}-divider`,
        text: "",
        level: 0,
        type: "divider",
      });
    }
  });
  tocEntries.push({
    id: "metadata-table",
    text: "原始數據",
    level: 1,
    type: "entry",
  });
  return tocEntries;
}
