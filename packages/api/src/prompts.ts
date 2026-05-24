import { Type } from "@google/genai";

export function shouldSkipAnalysis(categoryCode: number | null | undefined): boolean {
  return categoryCode !== 3;
}

export function buildAnalysisPrompt(input: {
  agendaId: string;
  subject: string | null;
  meetingDates: string[];
  sourceText: string;
}): string {
  return `你是一位專業的台灣立法院議事紀錄分析師。請根據以下立法院委員會議事紀錄，產生結構化 JSON 摘要。

你必須使用台灣繁體中文，保持客觀、中立、精確，並且只根據原文內容，不要臆測。

## 會議基本資料
- agenda_id: ${input.agendaId}
- 會議日期: ${input.meetingDates.join(", ") || "未知"}
- 議程主旨: ${input.subject ?? "未知"}

## 委員會名稱判斷
若這是委員會紀錄，請從原文中判斷所屬委員會。請只使用下列名稱，並以 JSON 字串陣列輸出：

- 內政委員會
- 外交及國防委員會
- 經濟委員會
- 財政委員會
- 教育及文化委員會
- 交通委員會
- 司法及法制委員會
- 社會福利及衛生環境委員會
- 程序委員會
- 紀律委員會
- 修憲委員會
- 經費稽核委員會

若為聯席會議，請列出所有相關委員會，例如 ["財政委員會", "內政委員會"]。若無法判斷，請輸出 null 或 []。

## 數字格式規則
摘要中的所有數字都必須使用阿拉伯數字，不要使用中文數字。

正確範例：
- 第 35 條
- 討論事項第 11 案
- 113 年
- 45%
- 2/3
- 15 個基數
- 50 億 4,750 萬元

## 輸出 JSON 格式
請只輸出 JSON，不要加入 Markdown，不要加入額外說明。格式如下：

{
  "summary_title": "50 字內，代表全文核心焦點的摘要標題",
  "overall_summary_sentence": "約 100-150 字，概括整份紀錄的主要內容、流程、法案全名或關鍵議題與重要結論",
  "committee_name": ["委員會名稱"],
  "agenda_items": [
    {
      "item_title": "議程項目的核心法案名稱與議程編號，省略提案人姓名",
      "core_issue": [
        "該議程項目的核心問題、背景或主要討論內容，最多 2 點"
      ],
      "controversy": [
        "主要爭議點，包含不同意見、理由或分歧，最多 7 點；無明顯爭議可為 null 或 []"
      ],
      "legislator_speakers": [
        {
          "speaker_name": "黃國昌 立法委員",
          "speaker_viewpoint": [
            "該委員的核心質詢、主張、理由或建議，最多 5 點，排除程序性發言"
          ]
        }
      ],
      "respondent_speakers": [
        {
          "speaker_name": "陳建仁 行政院院長",
          "speaker_viewpoint": [
            "政府官員、事業代表、專家、公民或產業代表的答覆、資料、政策立場或承諾，最多 10 點"
          ]
        }
      ],
      "result_status_next": [
        "此議程的處理結果、審查進度或下一步行動，最多 5 點，排除單純程序宣告"
      ]
    }
  ]
}

## 寫作要求
- summary_title 必須短而準確，避免聳動。
- overall_summary_sentence 要讓讀者快速理解這場會議在討論什麼、誰回應、結果如何。
- agenda_items 應依照實質議程拆分。若同一議程內有多個法案或主題，可視原文脈絡合併或拆開。
- core_issue 保留問題背景與政策脈絡，不要只寫標題。
- controversy 要呈現不同立場的具體理由，而不是只寫「有爭議」。
- speaker_name：
  - 立法委員格式為「姓名 立法委員」（例如「黃國昌 立法委員」），不要加黨籍。若原文出現「黃委員國昌」，請自動去除中間的「委員」職稱，僅保留「黃國昌 立法委員」。
  - 官員或代表格式為「姓名 完整職稱」（例如「莊翠雲 財政部部長」），必要時加所屬單位。若原文出現「莊部長翠雲」或「曾署長國基」，請務必將夾雜在姓名中間的職稱（如部長、署長、局長、次長）移到姓名後方，轉為乾淨的「姓名 完整職稱」（例如轉為「莊翠雲 財政部部長」、「曾國基 財政部國有財產署署長」）。
- speaker_viewpoint 只保留有實質政策、法律、預算、執行或監督意義的內容。
- result_status_next 只保留實質結果，例如保留協商、另擇期審查、要求書面報告、主管機關承諾期限等。
- 忽略 [image: imageXXX.jpg] 這類圖片標記。
- 若全文只有程序性內容、沒有實質討論，請輸出：
{
  "summary_title": "程序性內容",
  "overall_summary_sentence": "本次記錄主要為程序性內容，無實質討論摘要。",
  "committee_name": null,
  "agenda_items": []
}

## 議事紀錄原文
${input.sourceText}`;
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
      description: "會議所屬的一個或多個委員會名稱。聯席會議列出所有相關委員會。",
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
            description: "主要爭議點與不同意見。無明顯爭議則為 null 或空陣列。",
          },
          legislator_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要質詢或提案的立法委員與其觀點。",
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
  required: ["summary_title", "overall_summary_sentence", "committee_name", "agenda_items"],
  propertyOrdering: ["summary_title", "overall_summary_sentence", "committee_name", "agenda_items"],
};
