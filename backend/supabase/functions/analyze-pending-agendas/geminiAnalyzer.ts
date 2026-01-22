// backend/supabase/functions/analyze-pending-agendas/geminiAnalyzer.ts
import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GenerationConfig,
  type SafetySetting,
  type Schema,
  Type,
  type Content,
} from "npm:@google/genai";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
} from "../_shared/types/analysis.ts";
import { GEMINI_MODEL_NAME } from "./index.ts";
import { JOB_NAME_ANALYZER } from "../_shared/utils.ts";

// --- Schema 定義 (保持原本的詳細描述，這能幫助 AI 產出更精準的內容) ---
const speakerDetailSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    speaker_name: {
      type: Type.STRING,
      nullable: true,
      description:
        "發言者姓名及其職稱/單位。例如：'黃國昌 立法委員' 或 '陳建仁 行政院院長'。",
    },
    speaker_viewpoint: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
      description:
        "該發言者針對當前議程提出的具體論點、主要理由、建議、質詢、答覆或專業意見。避免程序性發言。",
    },
  },
  required: ["speaker_name"],
  propertyOrdering: ["speaker_name", "speaker_viewpoint"],
};

const analysisResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary_title: {
      type: Type.STRING,
      description: "代表全文核心焦點的高度概括性摘要標題 (50字內)。",
    },
    overall_summary_sentence: {
      type: Type.STRING,
      description:
        "整份議事記錄的主要內容、流程、法案全名或關鍵議題、以及重要結論的概括性總結 (約100-150字)。",
    },
    committee_name: {
      type: Type.ARRAY,
      nullable: true,
      description:
        "會議所屬的一個或多個委員會名稱陣列。單一委員會僅一個元素，聯席會議則包含所有相關委員會。",
      items: { type: Type.STRING },
    },
    agenda_items: {
      type: Type.ARRAY,
      nullable: true,
      description: "議事記錄中所有主要議程項目的詳細列表。",
      items: {
        type: Type.OBJECT,
        properties: {
          item_title: {
            type: Type.STRING,
            nullable: true,
            description:
              "議程項目的核心法案名稱與議程編號，例如 '某某法案修正草案 (討論事項第一案)'。",
          },
          core_issue: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description: "該議程項目詳細的核心問題、背景或主要討論內容。",
          },
          controversy: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "該議程項目主要的爭議點，包含不同意見的具體內容和理由。",
          },
          legislator_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要質詢或提案的「立法委員」列表及其觀點。",
            items: speakerDetailSchema,
          },
          respondent_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description:
              "主要答詢或報告的「政府官員」或「相關代表」列表及其觀點/回應。",
            items: speakerDetailSchema,
          },
          result_status_next: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "關於此議程的最終處理結果、審查進度或下一步行動的說明。",
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
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
  propertyOrdering: [
    "summary_title",
    "overall_summary_sentence",
    "committee_name",
    "agenda_items",
  ],
};

export async function analyzeWithGemini(
  fullPromptString: string,
  apiKey: string,
  _originalInputTextContent_for_logging_only: string,
  generationConfigParams: any,
  safetySettingsParams: SafetySetting[],
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  const ai = new GoogleGenAI({ apiKey });

  // 適配 Gemini 3 的參數結構
  const effectiveGenerationConfig: any = {
    ...generationConfigParams,
    responseMimeType: "application/json",
    responseSchema: analysisResponseSchema,
  };

  const params: any = {
    model: GEMINI_MODEL_NAME,
    contents: [{ role: "user", parts: [{ text: fullPromptString }] }],
    config: {
      ...effectiveGenerationConfig,
      safetySettings: safetySettingsParams,
    },
  };

  console.log(
    `[${JOB_NAME_ANALYZER}-Gemini] Initializing Gemini 3 client. Level: ${params.config?.thinkingConfig?.thinkingLevel}`,
  );

  let rawResponseTextForError: string | undefined = undefined;

  try {
    const result: GenerateContentResponse =
      await ai.models.generateContent(params);

    // --- 原本優秀的日誌與 Usage 監控邏輯 ---
    const usageMetadata = result.usageMetadata;
    if (usageMetadata) {
      console.log(
        `[Gemini-Usage] Tokens: ${usageMetadata.totalTokenCount} (P: ${usageMetadata.promptTokenCount}, C: ${usageMetadata.candidatesTokenCount})`,
      );
    }

    const finishReason = result.candidates?.[0]?.finishReason;
    console.log(`[Gemini-Status] Finish Reason: ${finishReason || "N/A"}`);

    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts?.[0]) {
      return {
        error: "Incomplete candidate content.",
        type: "MALFORMED_RESPONSE",
        rawOutput: JSON.stringify(result),
      };
    }

    const part = candidate.content.parts[0];
    if (!("text" in part)) {
      return {
        error: "Response part lacks valid text.",
        type: "EMPTY_RESPONSE_PART",
        rawOutput: JSON.stringify(result),
      };
    }

    rawResponseTextForError = part.text;

    // --- 嚴格的 Finish Reason 分類 (保留原有的錯誤分類機制) ---
    if (finishReason === "MAX_TOKENS") {
      return {
        error: "AI output truncated (MAX_TOKENS).",
        type: "MAX_TOKENS",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "SAFETY") {
      return {
        error: "AI output terminated by safety rules.",
        type: "SAFETY",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "OTHER") {
      return {
        error: "AI output terminated (OTHER reason).",
        type: "SCHEMA_ERROR_OR_OTHER",
        rawOutput: rawResponseTextForError,
      };
    }

    // --- 原本強大的 Markdown 清理邏輯 ---
    let textToParse = part.text;
    const markdownBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
    const match = textToParse.trim().match(markdownBlockRegex);
    if (match && match[1]) {
      textToParse = match[1].trim();
    } else {
      // 備用的手動清理 logic
      let tempText = textToParse.trim();
      if (tempText.startsWith("```json")) tempText = tempText.substring(7);
      else if (tempText.startsWith("```")) tempText = tempText.substring(3);
      if (tempText.endsWith("```"))
        tempText = tempText.substring(0, tempText.length - 3);
      textToParse = tempText.trim();
    }

    const parsedJson = JSON.parse(textToParse);
    const jsonResult = parsedJson as AnalysisResultJson;

    // --- 原本嚴謹的 Client-side Validation (確保前端不崩潰) ---
    if (
      jsonResult &&
      typeof jsonResult.summary_title === "string" &&
      typeof jsonResult.overall_summary_sentence === "string" &&
      (jsonResult.committee_name === null ||
        Array.isArray(jsonResult.committee_name)) &&
      (jsonResult.agenda_items === null ||
        Array.isArray(jsonResult.agenda_items))
    ) {
      console.log(`[Gemini-Success] JSON parsed and validated.`);
      return jsonResult;
    } else {
      return {
        error: "Parsed JSON failed client-side validation.",
        type: "INVALID_STRUCTURE_POST_SCHEMA",
        rawOutput: rawResponseTextForError,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[Gemini-Critical] Error during API call or JSON parsing:`,
      error,
    );

    // --- 原本詳細的 Error Type 映射邏輯 ---
    let errorType: any = "API_CALL_OR_PARSE_ERROR";
    if (error instanceof SyntaxError)
      errorType = "JSON_PARSE_ERROR_WITH_SCHEMA";
    else if (errorMsg.includes("SAFETY")) errorType = "SAFETY";
    else if (errorMsg.includes("quota") || errorMsg.includes("429"))
      errorType = "QUOTA_EXCEEDED";
    else if (errorMsg.includes("timeout")) errorType = "TIMEOUT_ERROR";

    return {
      error: `Gemini 3 call failed: ${errorMsg}`,
      type: errorType,
      rawOutput: rawResponseTextForError,
    };
  }
}
