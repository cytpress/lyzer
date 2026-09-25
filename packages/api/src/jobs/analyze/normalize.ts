// 清理發言者名稱並驗證模型輸出的分析資料
import { normalizeAnalysis, shouldSkipAnalysis } from "@/prompts";
import type { JsonObject } from "@/types";

export function cleanSpeakerName(name: string | null | undefined, isLegislator = false): string {
  if (!name) return "";

  // 1. 先把空格切開，提取出「名字部分」和「職稱部分」
  const parts = name.trim().replace(/\s+/g, " ").split(" ");
  let namePart = parts[0] ?? "";
  const titlePart = parts.slice(1).join(" ");

  // 2. 去除名字部分的 "立法委員"、"委員"、"立法"
  namePart = namePart.replace(/\s*(立法委員|委員|立法)\s*/g, "").trim();

  // 3. 處理官員常見的「姓 + 職稱 + 名」格式，例如「莊部長翠雲」->「莊翠雲」
  const titleRegex =
    /^([\u4e00-\u9fa5])(部長|署長|局長|次長|主任委員|主任|主委|處長|組長|司長|科長|秘書長|常務次長|政務次長|代理部長|代理署長|代理局長|總經理|董事長|行長|理事長)([\u4e00-\u9fa5]+)$/;
  const match = namePart.match(titleRegex);
  if (match) {
    const lastName = match[1];
    const firstName = match[3];
    namePart = `${lastName}${firstName}`;
  }

  // 4. 重組回傳
  if (isLegislator) {
    // 立法委員統一後綴「立法委員」
    return `${namePart} 立法委員`;
  } else {
    // 官員/答詢代表保留原始完整職稱
    return titlePart ? `${namePart} ${titlePart}` : namePart;
  }
}

export function normalizeAnalysisResult(analysis: JsonObject, categoryCode: number | null): JsonObject {
  if (categoryCode === null || shouldSkipAnalysis(categoryCode)) {
    throw new Error(`Unsupported analysis category_code: ${categoryCode}`);
  }

  const normalized = normalizeAnalysis(analysis, categoryCode);
  if (Array.isArray(normalized.agenda_items)) {
    for (const item of normalized.agenda_items) {
      if (item && typeof item === "object") {
        const itemObj = item as JsonObject;
        if (Array.isArray(itemObj.legislator_speakers)) {
          for (const speaker of itemObj.legislator_speakers) {
            if (speaker && typeof speaker === "object") {
              const speakerObj = speaker as JsonObject;
              speakerObj.speaker_name = cleanSpeakerName(speakerObj.speaker_name as string, true);
            }
          }
        }
        if (Array.isArray(itemObj.respondent_speakers)) {
          for (const speaker of itemObj.respondent_speakers) {
            if (speaker && typeof speaker === "object") {
              const speakerObj = speaker as JsonObject;
              speakerObj.speaker_name = cleanSpeakerName(speakerObj.speaker_name as string);
            }
          }
        }
      }
    }
  }

  return normalized;
}
