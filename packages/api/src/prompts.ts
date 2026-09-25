// 定義分析輸出結構並正規化不同類別的模型結果
import { Type } from "@google/genai";
import { buildCaucusPrompt } from "@/prompts/caucus";
import { buildCommitteePrompt } from "@/prompts/committee";
import type { JsonObject } from "@/types";

export const ALLOWED_COMMITTEE_NAMES = [
  "內政委員會",
  "外交及國防委員會",
  "經濟委員會",
  "財政委員會",
  "教育及文化委員會",
  "交通委員會",
  "司法及法制委員會",
  "社會福利及衛生環境委員會",
  "程序委員會",
  "紀律委員會",
  "修憲委員會",
  "全院委員會",
] as const;

export const HIDDEN_COMMITTEE_NAMES = new Set(["程序委員會", "紀律委員會", "修憲委員會", "全院委員會"]);

export function shouldSkipAnalysis(categoryCode: number | null | undefined): boolean {
  return categoryCode !== 3 && categoryCode !== 8;
}

export function normalizeAnalysis(analysis: JsonObject, categoryCode: number): JsonObject {
  const normalized: JsonObject = { ...analysis };
  const rawCommitteeNames = Array.isArray(analysis.committee_name) ? analysis.committee_name : [];
  const committeeNames = rawCommitteeNames.filter(
    (name): name is string =>
      typeof name === "string" && ALLOWED_COMMITTEE_NAMES.includes(name as (typeof ALLOWED_COMMITTEE_NAMES)[number])
  );
  const hasAgendaItems = Array.isArray(analysis.agenda_items) && analysis.agenda_items.length > 0;
  const modelPublic = analysis.is_public !== false;

  if (categoryCode === 8) {
    normalized.document_type = "黨團協商";
    normalized.committee_name = null;
    normalized.is_public = hasAgendaItems && modelPublic;
    return normalized;
  }

  normalized.document_type = "委員會";
  normalized.committee_name = committeeNames.length > 0 ? committeeNames : null;
  normalized.is_public =
    hasAgendaItems && modelPublic && !committeeNames.some((name) => HIDDEN_COMMITTEE_NAMES.has(name));
  return normalized;
}

export function buildAnalysisPrompt(input: { categoryCode: number; sourceText: string }): string {
  if (input.categoryCode === 3) return buildCommitteePrompt(input.sourceText);
  if (input.categoryCode === 8) return buildCaucusPrompt(input.sourceText);
  throw new Error(`Unsupported analysis category_code: ${input.categoryCode}`);
}

const speakerDetailSchema = {
  type: Type.OBJECT,
  properties: {
    speaker_name: {
      type: Type.STRING,
      nullable: true,
      description: "發言者姓名及職稱，例如「黃國昌 立法委員」或「陳建仁 行政院院長」。",
    },
    speaker_viewpoint: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.STRING },
      description: "該發言者的具體論點、理由、建議、質詢、答覆或承諾。",
    },
  },
  required: ["speaker_name"],
  propertyOrdering: ["speaker_name", "speaker_viewpoint"],
};

export const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    document_type: {
      type: Type.STRING,
      description: "資料類型，只能是「委員會」或「黨團協商」。",
    },
    is_public: {
      type: Type.BOOLEAN,
      description: "是否具有適合對外展示的實質內容。",
    },
    summary_title: {
      type: Type.STRING,
      description: "代表全文核心焦點的高度概括性摘要標題，50 字內。",
    },
    overall_summary_sentence: {
      type: Type.STRING,
      description: "整份議事紀錄主要內容、流程、關鍵議題與重要結論，約 100-150 字。",
    },
    committee_name: {
      type: Type.ARRAY,
      nullable: true,
      description: "會議所屬的一個或多個委員會名稱；無法判斷時為 null。",
      items: { type: Type.STRING },
    },
    agenda_items: {
      type: Type.ARRAY,
      nullable: true,
      description: "議事紀錄中所有主要議程項目的詳細列表。",
      items: {
        type: Type.OBJECT,
        properties: {
          item_title: {
            type: Type.STRING,
            nullable: true,
            description: "議程項目的核心法案名稱與議程編號。",
          },
          core_issue: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING },
            description: "該議程項目的核心問題、背景或主要討論內容。",
          },
          controversy: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING },
            description: "主要爭議點與不同意見；無明顯爭議時為 null。",
          },
          legislator_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要質詢、提案或協商的立法委員與其觀點。",
            items: speakerDetailSchema,
          },
          respondent_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要答詢、報告或回應的官員與相關代表。",
            items: speakerDetailSchema,
          },
          result_status_next: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING },
            description: "此議程的處理結果、審查進度或下一步行動。",
          },
        },
        required: ["item_title"],
        propertyOrdering: [
          "item_title",
          "core_issue",
          "controversy",
          "legislator_speakers",
          "respondent_speakers",
          "result_status_next",
        ],
      },
    },
  },
  required: [
    "document_type",
    "is_public",
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
  propertyOrdering: [
    "document_type",
    "is_public",
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
};
