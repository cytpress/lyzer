import { TocEntry } from "@/types/models";
import { AnalysisResultJson } from "@/types/analysisTypes";
import { slugify } from "@/utils/slugify";
import numberToChineseNumber from "./numberToChineseNumber";

interface GenerateTocEntriesParams {
  analysisResult: AnalysisResultJson;
}

/**
 * 遍歷分析結果中的所有議程項目和發言者，創建結構，
 * 以便在 `DetailedPageTableOfContent` 元件中渲染，並用於滾動定位。
 *
 * @param {GenerateTocEntriesParams} params - 包含 AI 分析結果的物件。
 * @returns {TocEntry[]} - 生成的目錄條目陣列。
 */
export default function generateTocEntries({
  analysisResult,
}: GenerateTocEntriesParams): TocEntry[] {
  if (!analysisResult) return [];

  const { agenda_items } = analysisResult;
  const tocEntries: TocEntry[] = [];

  agenda_items?.forEach((item, itemIndex) => {
    // 創建唯一ID用，避免有多個議題項目，卻重覆ID
    const idPrefix = `item-${itemIndex}`;

    // 一般項目，相對於詳細頁面中的 h3
    if (item.item_title) {
      tocEntries.push({
        id: `${idPrefix}-item-title`,
        text: `討論事項${numberToChineseNumber(itemIndex + 1)}`,
        type: "entry",
      });
    }
    if (item.core_issue) {
      tocEntries.push({
        id: `${idPrefix}-core-issues`,
        text: "核心議題",
        type: "entry",
      });
    }
    if (item.controversy) {
      tocEntries.push({
        id: `${idPrefix}-controversies`,
        text: "相關爭議",
        type: "entry",
      });
    }
    // 生成含有子項目的立法委員項目
    if (item.legislator_speakers && item.legislator_speakers.length > 0) {
      // 建立多個立法委員項目，作為"立法委員發言"的子項目
      const legislatorsTocChildren: TocEntry[] = item.legislator_speakers.map(
        (speaker) => {
          return {
            id: `${idPrefix}-speaker-${slugify(speaker.speaker_name!)}`,
            text: speaker.speaker_name!,
            type: "entry",
          };
        }
      );
      tocEntries.push({
        id: `${idPrefix}-legislators-speech`,
        text: "立法委員發言",
        children: legislatorsTocChildren, // 將子項目陣列賦值 children
        type: "entry",
      });
    }

    // 同立法委員，生成含有子項目的相關人員回覆項目
    if (item.respondent_speakers && item.respondent_speakers.length > 0) {
      // 建立多個相關人員回覆項目，作為"相關人員回覆"的子項目
      const respondentsTocChildren: TocEntry[] = item.respondent_speakers.map(
        (speaker) => {
          return {
            id: `${idPrefix}-speaker-${slugify(speaker.speaker_name!)}`,
            text: speaker.speaker_name!,
            type: "entry",
          };
        }
      );
      tocEntries.push({
        id: `${idPrefix}-respondents-response`,
        text: "相關人員回覆",
        children: respondentsTocChildren, // 將子項目陣列賦值 children
        type: "entry",
      });
    }
    if (item.result_status_next) {
      tocEntries.push({
        id: `${idPrefix}-result-next`,
        text: "相關後續",
        type: "entry",
      });
    }
    // 若會議中存在多個議題項目，則將分隔線作為toc的一個項目
    const isLastItem = itemIndex === agenda_items.length - 1;
    if (!isLastItem) {
      tocEntries.push({
        id: `${idPrefix}-divider`,
        text: "",
        type: "divider", // 特殊類型，用於渲染 <hr>
      });
    }
  });
  tocEntries.push({
    id: "metadata-table",
    text: "原始數據",
    type: "entry",
  });
  return tocEntries;
}
