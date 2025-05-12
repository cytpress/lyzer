// supabase/functions/analyze-pending-contents/geminiAnalyzer.ts
import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Content,
  type GenerationConfig,
  type SafetySetting,
  type Schema,
  SchemaType, // <<< 導入 SchemaType enum >>>
} from "npm:@google/generative-ai";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
  AgendaItem,
  KeySpeaker,
} from "../_shared/utils.ts";
import { GEMINI_MODEL_NAME, JOB_NAME } from "./index.ts";

// --- 定義回應 Schema ---
const analysisResponseSchema: Schema = {
  type: SchemaType.OBJECT, // <<< 使用 SchemaType.OBJECT >>>
  properties: {
    summary_title: {
      type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
      description: "會議或記錄的核心主題摘要標題 (50字內)",
    },
    overall_summary_sentence: {
      type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
      description: "整份議事記錄的主要內容、流程和重要結論概括 (約100-150字)",
    },
    committee_name: {
      type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
      nullable: true,
      description: "會議所屬的委員會名稱，無法判斷則為 null",
    },
    agenda_items: {
      type: SchemaType.ARRAY, // <<< 使用 SchemaType.ARRAY >>>
      nullable: true,
      description: "議程項目列表",
      items: {
        type: SchemaType.OBJECT, // <<< 使用 SchemaType.OBJECT >>>
        properties: {
          item_title: {
            type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
            nullable: true,
            description: "議程項目的標題或案由",
          },
          core_issue: {
            type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
            nullable: true,
            description:
              "核心問題或討論內容。若有多點，請用換行符 '\\n' 分隔於單一字串中。",
          },
          controversy: {
            type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
            nullable: true,
            description:
              "主要爭議點。若有多點，請用換行符 '\\n' 分隔。無爭議則為 null。",
          },
          key_speakers: {
            type: SchemaType.ARRAY, // <<< 使用 SchemaType.ARRAY >>>
            nullable: true,
            description: "主要發言者列表",
            items: {
              type: SchemaType.OBJECT, // <<< 使用 SchemaType.OBJECT >>>
              properties: {
                speaker_name: {
                  type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
                  nullable: true,
                  description: "發言者姓名或職稱",
                },
                speaker_viewpoint: {
                  type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
                  nullable: true,
                  description:
                    "主要觀點或立場。若有多點，請用換行符 '\\n' 分隔。",
                },
              },
              required: ["speaker_name", "speaker_viewpoint"],
            },
          },
          result_status_next: {
            type: SchemaType.STRING, // <<< 使用 SchemaType.STRING >>>
            nullable: true,
            description:
              "處理結果或下一步行動。若有多點，請用換行符 '\\n' 分隔。",
          },
        },
        required: ["item_title"],
      },
    },
  },
  required: ["summary_title", "overall_summary_sentence", "agenda_items"],
};

// 輔助函數：處理可能包含換行符分隔字串的欄位，將其轉換為陣列
function processFieldForArray(
  fieldValue: string | string[] | null
): string | string[] | null {
  if (typeof fieldValue === "string" && fieldValue.includes("\n")) {
    // 分割並去除空白元素
    return fieldValue
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return fieldValue; // 如果不是帶換行符的字串，或已是陣列/null，直接返回
}

export async function analyzeWithGemini(
  fullPromptString: string, // 這個 prompt 現在主要是內容和任務描述
  apiKey: string,
  originalInputTextContent: string,
  // 從 index.ts 傳入基礎的 generationConfig 和 safetySettings
  generationConfigParams: Omit<
    GenerationConfig,
    | "responseMimeType"
    | "responseSchema"
    | "candidateCount"
    | "stopSequences"
    | "topP"
    | "topK"
  >,
  safetySettingsParams: SafetySetting[]
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  // 組合最終的 GenerationConfig，加入 schema 和 mimeType
  const currentGenerationConfig: GenerationConfig = {
    ...generationConfigParams,
    responseMimeType: "application/json", // 強制 JSON 輸出
    responseSchema: analysisResponseSchema, // 應用我們定義的 schema
    // thinkingConfig 已暫時移除
  };

  // 為了日誌簡潔，可以選擇不打印完整的 schema
  const configForLog = { ...currentGenerationConfig };
  // delete configForLog.responseSchema; // 取消註解此行以在日誌中隱藏 schema 細節
  console.log(
    `[${JOB_NAME}-Gemini] 本次呼叫的有效 generationConfig (schema 存在: ${!!configForLog.responseSchema}): ${JSON.stringify(
      configForLog
    )}`
  );
  console.log(
    `[${JOB_NAME}-Gemini] 初始化 Gemini 客戶端，模型: ${GEMINI_MODEL_NAME}`
  );

  let contentSeemsTruncatedByEllipsis = false; // 用於檢測不自然的省略號
  function checkForEllipsisTruncation(obj: unknown): void {
    if (typeof obj === "string" && obj.endsWith("...")) {
      // 條件：長度大於10，且 "..." 前一個字符不是常見的句子結尾標點或空格
      if (
        obj.length > 10 &&
        obj.charAt(obj.length - 4) !== " " && // 不是空格
        obj.charAt(obj.length - 4) !== "。" && // 不是中文句號
        obj.charAt(obj.length - 4) !== "」" && // 不是右引號
        obj.charAt(obj.length - 4) !== "！" && // 不是驚嘆號
        obj.charAt(obj.length - 4) !== "？" // 不是問號
      ) {
        contentSeemsTruncatedByEllipsis = true;
        console.warn(
          `[${JOB_NAME}-Gemini] 警告：在字串值中發現潛在的內容省略號截斷 (前100字元): "${obj.substring(
            0,
            100
          )}..."`
        );
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) checkForEllipsisTruncation(item);
    } else if (typeof obj === "object" && obj !== null) {
      for (const key in obj as Record<string, unknown>) {
        // 類型斷言
        checkForEllipsisTruncation((obj as Record<string, unknown>)[key]);
      }
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelInstance: GenerativeModel = genAI.getGenerativeModel({
      // 明確模型實例類型
      model: GEMINI_MODEL_NAME,
      safetySettings: safetySettingsParams, // 使用傳入的安全設置
      generationConfig: currentGenerationConfig, // 使用包含 schema 的生成配置
    });

    const contentsForApi: Content[] = [
      // API 請求的內容結構
      { role: "user" as const, parts: [{ text: fullPromptString }] },
    ];

    try {
      const countTokensResponse = await modelInstance.countTokens({
        contents: contentsForApi,
        // 注意: responseSchema 本身也會消耗 token, countTokens 可能未完全包含此部分
      });
      console.log(
        `[${JOB_NAME}-Gemini] 估計的輸入 Prompt (文本部分) Token 數量: ${countTokensResponse.totalTokens}`
      );
    } catch (countError) {
      console.warn(
        `[${JOB_NAME}-Gemini] 計算輸入 Token 時發生錯誤 (用於調試): ${countError.message}`
      );
    }

    console.log(`[${JOB_NAME}-Gemini] 正在從 ${GEMINI_MODEL_NAME} 請求分析...`);
    console.log(
      `[${JOB_NAME}-Gemini] 原始輸入文本字元長度: ${originalInputTextContent.length}`
    );
    console.log(
      `[${JOB_NAME}-Gemini] 完整 Prompt (文本部分) 字元長度: ${fullPromptString.length}`
    );

    const result = await modelInstance.generateContent({
      contents: contentsForApi,
      // generationConfig 和 safetySettings 已在 modelInstance 初始化時設定
    });
    const response = result.response;

    if (response) {
      const usageMetadata = response.usageMetadata;
      if (usageMetadata) {
        console.log(
          `[${JOB_NAME}-Gemini] 用量元數據 - Prompt Tokens: ${usageMetadata.promptTokenCount}, Candidates Tokens: ${usageMetadata.candidatesTokenCount}, 總 Tokens: ${usageMetadata.totalTokenCount}`
        );
      } else {
        console.warn(`[${JOB_NAME}-Gemini] Gemini 回應中未找到用量元數據。`);
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      const safetyRatings =
        response.promptFeedback?.safetyRatings ||
        response.candidates?.[0]?.safetyRatings;
      console.log(`[${JOB_NAME}-Gemini] 完成原因: ${finishReason || "N/A"}`);
      if (safetyRatings && safetyRatings.length > 0) {
        console.log(
          `[${JOB_NAME}-Gemini] 安全評級: ${JSON.stringify(safetyRatings)}`
        );
      }

      const responseText = response.text ? response.text() : null;

      if (finishReason === "MAX_TOKENS") {
        console.error(
          `[${JOB_NAME}-Gemini] 嚴重：輸出因達到 MAX_TOKENS 限制而被截斷。`
        );
        return {
          error: `AI 輸出因達到最大 token 限制而被截斷 (MAX_TOKENS). Candidates Tokens: ${
            usageMetadata?.candidatesTokenCount || "N/A"
          }`,
          type: "MAX_TOKENS",
          rawOutput: responseText ?? undefined,
        };
      }
      if (finishReason === "SAFETY") {
        console.error(`[${JOB_NAME}-Gemini] 嚴重：輸出因安全設定而被停止。`);
        return {
          error: `AI 輸出因安全設定而被終止 (SAFETY). 評級: ${JSON.stringify(
            safetyRatings
          )}`,
          type: "SAFETY",
          rawOutput: responseText ?? undefined,
        };
      }
      if (finishReason === "OTHER") {
        console.error(
          `[${JOB_NAME}-Gemini] 嚴重：輸出因其他原因停止。這可能與 schema 有關。`
        );
        return {
          error: `AI 輸出因其他原因終止 (OTHER)。這可能與提供的 responseSchema 不相容有關。`,
          type: "SCHEMA_ERROR_OR_OTHER",
          rawOutput: responseText ?? undefined,
        };
      }
      if (responseText === null || responseText.trim() === "") {
        console.error(
          `[${JOB_NAME}-Gemini] 回應文本為空或空白，即使完成原因是 ${finishReason}。`
        );
        return {
          error:
            "Gemini 回應文本為空或無法提取 (可能是 schema 約束導致無有效輸出)",
          type: "EMPTY_RESPONSE",
          rawOutput: responseText ?? undefined,
        };
      }

      try {
        // 因為 responseMimeType 是 application/json, responseText 應該就是純 JSON 字串
        const parsedJson = JSON.parse(responseText);
        const jsonResult = parsedJson as AnalysisResultJson; // 使用 const 進行類型斷言

        contentSeemsTruncatedByEllipsis = false; // 重置標誌
        if (finishReason === "STOP") {
          // 仍然可以檢查 "..."
          checkForEllipsisTruncation(jsonResult);
        }

        if (contentSeemsTruncatedByEllipsis) {
          console.warn(
            `[${JOB_NAME}-Gemini] 警告：輸出已完成 (STOP) 且符合 Schema，但內容中包含 '...' 省略號。`
          );
          // 根據需求決定是否將此情況視為錯誤並返回錯誤對象
          // return { error: "AI輸出內容雖然符合Schema，但部分字串疑似被不自然的省略號結束", type: "CONTENT_ELLIPSIS_IN_VALID_SCHEMA", rawOutput: responseText, parsedResult: jsonResult };
        }

        // 頂層結構的基本驗證（大部分應由 API 的 schema 驗證保證）
        if (
          jsonResult &&
          typeof jsonResult === "object" &&
          typeof jsonResult.summary_title === "string" &&
          typeof jsonResult.overall_summary_sentence === "string" &&
          (jsonResult.agenda_items === null ||
            Array.isArray(jsonResult.agenda_items)) // agenda_items 可以是 null 或陣列
        ) {
          console.log(
            `[${JOB_NAME}-Gemini] 分析成功 (JSON 已解析且 schema 結構已由 API 驗證)。`
          );

          // 進行後處理：將 agenda_items 中特定欄位的換行符字串轉換為陣列
          const processedResult: AnalysisResultJson = {
            ...jsonResult, // 複製原始解析結果
            agenda_items: jsonResult.agenda_items
              ? jsonResult.agenda_items.map((item: AgendaItem) => {
                  // 明確 item 類型
                  const newItem: AgendaItem = { ...item }; // 創建副本以避免修改原始 jsonResult
                  // 檢查欄位是否存在且為字串才進行處理
                  if (typeof newItem.core_issue === "string")
                    newItem.core_issue = processFieldForArray(
                      newItem.core_issue
                    );
                  if (typeof newItem.controversy === "string")
                    newItem.controversy = processFieldForArray(
                      newItem.controversy
                    );
                  if (typeof newItem.result_status_next === "string")
                    newItem.result_status_next = processFieldForArray(
                      newItem.result_status_next
                    );

                  if (newItem.key_speakers) {
                    newItem.key_speakers = newItem.key_speakers.map(
                      (speaker: KeySpeaker) => {
                        // 明確 speaker 類型
                        const newSpeaker: KeySpeaker = { ...speaker };
                        if (typeof newSpeaker.speaker_viewpoint === "string")
                          newSpeaker.speaker_viewpoint = processFieldForArray(
                            newSpeaker.speaker_viewpoint
                          );
                        return newSpeaker;
                      }
                    );
                  }
                  return newItem;
                })
              : null, // 如果原始 agenda_items 為 null，則保持 null
          };
          return processedResult; // 返回經過後處理的結果
        } else {
          console.warn(
            `[${JOB_NAME}-Gemini] 已解析的 JSON (已由 schema 驗證) 仍缺少預期的頂層結構/類型。這種情況應該很少見。`
          );
          return {
            error:
              "AI 輸出的 JSON 結構不符合預期 (可能是 schema 非常寬鬆或 SDK 返回了意外格式)",
            type: "INVALID_STRUCTURE_POST_SCHEMA",
            rawOutput: responseText,
            parsedResult: jsonResult, // 保存解析後的結果以供調試
          };
        }
      } catch (parseError) {
        // 理論上，如果 API 嚴格遵循 schema，這裡的 JSON 解析錯誤應該很少見
        console.error(
          `[${JOB_NAME}-Gemini] JSON 解析錯誤 (設定 responseSchema 後應很少見): ${parseError.message}.`
        );
        console.error(
          `[${JOB_NAME}-Gemini] 解析失敗的原始文本 (前500 + 後500 字元):\n頭部>>>${responseText?.substring(
            0,
            500
          )}\n...\n尾部>>>${responseText?.slice(-500)}`
        );
        return {
          error: `AI 未按要求輸出有效 JSON (解析錯誤，即使設定了 responseSchema): ${parseError.message}`,
          type: "JSON_PARSE_ERROR_WITH_SCHEMA",
          rawOutput: responseText,
        };
      }
    } else {
      console.error(
        `[${JOB_NAME}-Gemini] Gemini 結果中沒有 'response' 物件 (已設定 responseSchema)。`
      );
      return {
        error:
          "Gemini API 未返回有效的 response 物件 (即使設定了 responseSchema)",
        type: "EMPTY_RESPONSE",
      };
    }
  } catch (error) {
    console.error(`[${JOB_NAME}-Gemini] 外部 API 呼叫錯誤:`, error);
    let errorMessage = `Gemini API 呼叫失敗: ${error.message || String(error)}`;
    // 增加對 schema 相關錯誤的判斷
    if (
      error.message?.includes("SCHEMA_ERROR") ||
      (error.message?.includes("InvalidArgument") &&
        error.message?.includes("response_schema"))
    ) {
      errorMessage = `Gemini API 呼叫失敗，可能與 responseSchema 配置有關: ${error.message}`;
    } else if (error.message?.includes("SAFETY")) {
      errorMessage = `內容或回應觸發安全規則: ${error.message}`;
    } else if (
      error.message?.includes("fetch failed") ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED"
    ) {
      errorMessage = `網路錯誤，無法連接 Gemini API: ${error.message}`;
    } else if (error.message?.includes("API key not valid")) {
      errorMessage = `Gemini API 金鑰無效: ${error.message}`;
    } else if (
      error.message?.includes("Deadline exceeded") ||
      error.message?.includes("timeout")
    ) {
      errorMessage = `Gemini API 呼叫超時: ${error.message}`;
    } else if (error.status && error.statusText) {
      // 檢查 HTTP 錯誤
      errorMessage = `Gemini API HTTP 錯誤 ${error.status}: ${error.statusText}. 詳細信息: ${error.message}`;
    }

    return { error: errorMessage, type: "API_CALL_ERROR" };
  }
}
