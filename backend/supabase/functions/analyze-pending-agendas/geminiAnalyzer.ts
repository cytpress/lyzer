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
} from "../_shared/utils.ts";
// 從同目錄的 index.ts 導入 GEMINI_MODEL_NAME
// 從 _shared/utils.ts 導入 JOB_NAME_ANALYZER
import { GEMINI_MODEL_NAME } from "./index.ts";
import { JOB_NAME_ANALYZER } from "../_shared/utils.ts";

// --- 定義回應 Schema ---
const analysisResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary_title: {
      type: Type.STRING,
      description: "會議或記錄的核心主題摘要標題 (50字內)",
    },
    overall_summary_sentence: {
      type: Type.STRING,
      description: "整份議事記錄的主要內容、流程和重要結論概括 (約100-150字)",
    },
    committee_name: {
      type: Type.STRING,
      nullable: true,
      description: "會議所屬的委員會名稱，無法判斷則為 null",
    },
    agenda_items: {
      type: Type.ARRAY,
      nullable: true,
      description: "議程項目列表",
      items: {
        type: Type.OBJECT,
        properties: {
          item_title: {
            type: Type.STRING,
            nullable: true,
            description: "議程項目的標題或案由",
          },
          core_issue: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "核心問題或討論內容。若有多點，請作為陣列中的不同字串元素。",
          },
          controversy: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "主要爭議點。若有多點，請作為陣列中的不同字串元素。無爭議則為 null。",
          },
          key_speakers: {
            type: Type.ARRAY,
            nullable: true,
            description: "主要發言者列表",
            items: {
              type: Type.OBJECT,
              properties: {
                speaker_name: {
                  type: Type.STRING,
                  nullable: true,
                  description: "發言者姓名或職稱",
                },
                speaker_viewpoint: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  nullable: true,
                  description:
                    "主要觀點或立場。若有多點，請作為陣列中的不同字串元素。",
                },
              },
              required: ["speaker_name"],
              propertyOrdering: ["speaker_name", "speaker_viewpoint"],
            },
          },
          result_status_next: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
            description:
              "處理結果或下一步行動。若有多點，請作為陣列中的不同字串元素。",
          },
        },
        required: ["item_title"],
        propertyOrdering: [
          "item_title",
          "core_issue",
          "controversy",
          "key_speakers",
          "result_status_next",
        ],
      },
    },
  },
  required: ["summary_title", "overall_summary_sentence", "agenda_items"],
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
  generationConfigParams: Partial<GenerationConfig> & {
    thinkingConfig?: { thinkingBudget?: number };
  },
  safetySettingsParams: SafetySetting[]
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  const ai = new GoogleGenAI({ apiKey }); // 你的原始 SDK 初始化

  const effectiveGenerationConfig: GenerationConfig = {
    ...(generationConfigParams as GenerationConfig),
    responseMimeType: "application/json",
    responseSchema: analysisResponseSchema,
  };

  // 嚴格按照你原始程式碼的 params 結構
  // GenerateContentParameters 類型需要包含 model 字段才能匹配原始調用
  const params: GenerateContentParameters = {
    model: GEMINI_MODEL_NAME, // 將模型名稱包含在 params 中
    contents: [
      { role: "user", parts: [{ text: fullPromptString }] },
    ] as Content[],
    safetySettings: safetySettingsParams,
    generationConfig: effectiveGenerationConfig,
  };

  console.log(
    `[${JOB_NAME_ANALYZER}-Gemini] 初始化 Gemini 客戶端 (新SDK)，模型: ${
      params.model // 從 params 中讀取 model 進行日誌記錄
    }。思考預算: ${
      params.generationConfig?.thinkingConfig?.thinkingBudget ?? "預設/關閉"
    }`
  );

  let rawResponseTextForError: string | undefined = undefined;

  try {
    const result: GenerateContentResponse = await ai.models.generateContent(
      params
    );

    const usageMetadata = result.usageMetadata; // 保持原始路徑
    if (usageMetadata) {
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] 用量元數據 - Prompt Tokens: ${usageMetadata.promptTokenCount}, Candidates Tokens: ${usageMetadata.candidatesTokenCount}, 總 Tokens: ${usageMetadata.totalTokenCount}`
      );
    } else {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] Gemini 回應中未找到用量元數據。`
      );
    }

    const finishReason = result.candidates?.[0]?.finishReason; // 保持原始路徑
    const safetyRatings = // 保持原始路徑
      result.promptFeedback?.safetyRatings ||
      result.candidates?.[0]?.safetyRatings;
    console.log(
      `[${JOB_NAME_ANALYZER}-Gemini] 完成原因: ${finishReason || "N/A"}`
    );

    const candidate = result.candidates?.[0]; // 保持原始路徑
    if (
      !candidate ||
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0
    ) {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 無法從 API 回應中提取有效的候選內容或部分。原始回應: ${JSON.stringify(
          result
        )}`
      );
      return {
        error: "Gemini API 回應結構不完整或無候選內容",
        type: "MALFORMED_RESPONSE",
        rawOutput: JSON.stringify(result),
      };
    }

    const part = candidate.content.parts[0];
    if (!("text" in part && typeof part.text === "string")) {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 回應的 part 中沒有可識別的 text。Part 內容: ${JSON.stringify(
          part
        )}。原始回應: ${JSON.stringify(result)}`
      );
      return {
        error: "Gemini 回應部分缺少有效內容來解析 JSON",
        type: "EMPTY_RESPONSE_PART",
        rawOutput: JSON.stringify(result),
      };
    }

    let textToParse = part.text;
    rawResponseTextForError = textToParse;

    const markdownBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
    const match = textToParse.trim().match(markdownBlockRegex);
    if (match && match[1]) {
      textToParse = match[1].trim();
    } else if (textToParse.trim().startsWith("```")) {
      let tempText = textToParse.trim();
      tempText = tempText.substring(tempText.indexOf("```") + 3);
      if (tempText.trim().endsWith("```")) {
        tempText = tempText.substring(0, tempText.lastIndexOf("```"));
      }
      textToParse = tempText.trim();
    }

    if (finishReason === "MAX_TOKENS") {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 嚴重：輸出因達到 MAX_TOKENS 限制而被截斷。`
      );
      return {
        error: `AI 輸出因達到最大 token 限制而被截斷 (MAX_TOKENS). Candidates Tokens: ${
          usageMetadata?.candidatesTokenCount || "N/A"
        }`,
        type: "MAX_TOKENS",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "SAFETY") {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 嚴重：輸出因安全設定而被停止。`
      );
      return {
        error: `AI 輸出因安全設定而被終止 (SAFETY). 評級: ${JSON.stringify(
          safetyRatings
        )}`,
        type: "SAFETY",
        rawOutput: rawResponseTextForError,
      };
    }
    if (finishReason === "OTHER") {
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 嚴重：輸出因其他原因停止。這可能與 schema 有關。`
      );
      return {
        error: `AI 輸出因其他原因終止 (OTHER)。這可能與提供的 responseSchema 不相容有關。`,
        type: "SCHEMA_ERROR_OR_OTHER",
        rawOutput: rawResponseTextForError,
      };
    }

    if (
      finishReason !== "STOP" &&
      finishReason !== undefined &&
      finishReason !== null
    ) {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] 完成原因不是 STOP ('${finishReason}')，但仍嘗試解析 JSON。`
      );
    }

    const parsedJson = JSON.parse(textToParse);
    const jsonResult = parsedJson as AnalysisResultJson;

    if (
      jsonResult &&
      typeof jsonResult === "object" &&
      typeof jsonResult.summary_title === "string" &&
      typeof jsonResult.overall_summary_sentence === "string" &&
      (jsonResult.agenda_items === null ||
        Array.isArray(jsonResult.agenda_items))
    ) {
      console.log(
        `[${JOB_NAME_ANALYZER}-Gemini] 分析成功 (JSON 已解析且 schema 結構已由 API 初步驗證)。`
      );
      return jsonResult;
    } else {
      console.warn(
        `[${JOB_NAME_ANALYZER}-Gemini] 已解析的 JSON (可能通過 API schema 驗證) 但未通過客戶端基本結構檢查。`
      );
      return {
        error: "AI輸出的JSON未通過客戶端基本結構驗證",
        type: "INVALID_STRUCTURE_POST_SCHEMA",
        rawOutput: rawResponseTextForError,
        parsedResult: jsonResult,
      };
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME_ANALYZER}-Gemini] API 呼叫或 JSON 解析時發生錯誤:`,
      error
    );
    let errorMessage = `Gemini API 呼叫或 JSON 解析失敗: ${
      error.message || String(error)
    }`;
    let errorType = "API_CALL_OR_PARSE_ERROR";

    if (
      error.message?.includes("JSON.parse") ||
      error.message?.toLowerCase().includes("json") ||
      error instanceof SyntaxError
    ) {
      errorMessage = `無法解析 API 回應為 JSON (即使在清理後): ${error.message}`;
      errorType = "JSON_PARSE_ERROR_WITH_SCHEMA";
      console.error(
        `[${JOB_NAME_ANALYZER}-Gemini] 解析失敗的文本 (前 500 字元): ${
          rawResponseTextForError?.substring(0, 500) ?? "N/A"
        }`
      );
    } else if (
      error.message?.includes("SCHEMA_ERROR") ||
      (error.message?.includes("InvalidArgument") &&
        error.message?.includes("response_schema"))
    ) {
      errorMessage = `Gemini API 呼叫失敗，可能與 responseSchema 配置有關: ${error.message}`;
      errorType = "SCHEMA_ERROR_OR_OTHER";
    } else if (error.message?.includes("SAFETY")) {
      errorMessage = `內容或回應觸發安全規則: ${error.message}`;
      errorType = "SAFETY";
    } else if (
      error.message?.includes("fetch failed") ||
      (typeof error.code === "string" && error.code === "ENOTFOUND") ||
      (typeof error.code === "string" && error.code === "ECONNREFUSED")
    ) {
      errorMessage = `網路錯誤，無法連接 Gemini API: ${error.message}`;
      errorType = "NETWORK_ERROR";
    } else if (error.message?.includes("API key not valid")) {
      errorMessage = `Gemini API 金鑰無效: ${error.message}`;
      errorType = "AUTH_ERROR";
    } else if (
      error.message?.includes("Deadline exceeded") ||
      error.message?.includes("timeout")
    ) {
      errorMessage = `Gemini API 呼叫超時: ${error.message}`;
      errorType = "TIMEOUT_ERROR";
    } else if (error.status && error.statusText) {
      errorMessage = `Gemini API HTTP 錯誤 ${error.status}: ${error.statusText}. 詳細信息: ${error.message}`;
      errorType = "HTTP_ERROR";
    }

    if (error.message && error.message.includes("[GoogleGenerativeAI Error]")) {
      if (
        error.message.toLowerCase().includes("quota") ||
        error.message.toLowerCase().includes("resource_exhausted")
      ) {
        errorType = "QUOTA_EXCEEDED";
        errorMessage = `Gemini API 資源配額已用盡或請求過於頻繁: ${error.message}`;
      } else if (error.message.toLowerCase().includes("invalid_argument")) {
        errorType = "INVALID_ARGUMENT";
        errorMessage = `Gemini API 參數無效: ${error.message}`;
      } else {
        errorType = "GOOGLE_AI_ERROR";
      }
    }

    return {
      error: errorMessage,
      type: errorType,
      rawOutput: rawResponseTextForError,
    };
  }
}
