// supabase/functions/analyze-pending-contents/geminiAnalyzer.ts
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "npm:@google/generative-ai";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
} from "../_shared/utils.ts"; // 從 _shared 導入類型
import {
  GEMINI_MODEL_NAME,
  generationConfig,
  safetySettings,
  JOB_NAME,
} from "./index.ts"; // 從主 index.ts 導入配置

// analyzeWithGemini 函數現在在這個文件中
export async function analyzeWithGemini(
  fullPromptString: string,
  apiKey: string,
  originalInputTextContent: string
): Promise<AnalysisResultJson | GeminiErrorDetail> {
  console.log(
    `[${JOB_NAME}-Gemini] Effective generationConfig for this call: ${JSON.stringify(
      generationConfig
    )}`
  );
  console.log(
    `[${JOB_NAME}-Gemini] Initializing Gemini client with model: ${GEMINI_MODEL_NAME}`
  );

  let contentSeemsTruncatedByEllipsis = false;
  function checkForEllipsisTruncation(obj: unknown): void {
    if (typeof obj === "string" && obj.endsWith("...")) {
      if (
        obj.length > 10 &&
        obj.charAt(obj.length - 4) !== " " &&
        obj.charAt(obj.length - 4) !== "。" &&
        obj.charAt(obj.length - 4) !== "」"
      ) {
        contentSeemsTruncatedByEllipsis = true;
        console.warn(
          `[${JOB_NAME}-Gemini] Potential content truncation by ellipsis found in string value (first 100 chars): "${obj.substring(
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
    const modelInstance = genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      safetySettings: safetySettings,
      generationConfig: generationConfig,
    });

    const contentsForTokenCount = [
      { role: "user" as const, parts: [{ text: fullPromptString }] },
    ];
    try {
      const countTokensResponse = await modelInstance.countTokens({
        contents: contentsForTokenCount,
      });
      console.log(
        `[${JOB_NAME}-Gemini] Estimated INPUT prompt token count: ${countTokensResponse.totalTokens}`
      );
    } catch (countError) {
      console.warn(
        `[${JOB_NAME}-Gemini] Failed to count input tokens for debugging: ${countError.message}`
      );
    }

    console.log(
      `[${JOB_NAME}-Gemini] Requesting analysis from ${GEMINI_MODEL_NAME}... (Thinking budget: ${generationConfig.thinkingConfig.thinkingBudget})`
    );
    console.log(
      `[${JOB_NAME}-Gemini] Original input text char length: ${originalInputTextContent.length}`
    );
    console.log(
      `[${JOB_NAME}-Gemini] Full prompt char length (template + input): ${fullPromptString.length}`
    );

    const result = await modelInstance.generateContent({
      contents: contentsForTokenCount,
    });
    const response = result.response;

    if (response) {
      const usageMetadata = response.usageMetadata;
      if (usageMetadata) {
        console.log(
          `[${JOB_NAME}-Gemini] Usage Metadata - Prompt Tokens: ${usageMetadata.promptTokenCount}, ` +
            `Candidates Tokens: ${usageMetadata.candidatesTokenCount}, ` +
            `Total Tokens: ${usageMetadata.totalTokenCount}`
        );
      } else {
        console.warn(
          `[${JOB_NAME}-Gemini] Usage Metadata not found in Gemini response.`
        );
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      const safetyRatings =
        response.promptFeedback?.safetyRatings ||
        response.candidates?.[0]?.safetyRatings;
      console.log(
        `[${JOB_NAME}-Gemini] Finish Reason: ${finishReason || "N/A"}`
      );
      if (safetyRatings && safetyRatings.length > 0) {
        console.log(
          `[${JOB_NAME}-Gemini] Safety Ratings: ${JSON.stringify(
            safetyRatings
          )}`
        );
      }

      const responseText = response.text ? response.text() : null;

      if (finishReason === "MAX_TOKENS") {
        console.error(
          `[${JOB_NAME}-Gemini] CRITICAL: Output was TRUNCATED because it reached MAX_TOKENS limit.`
        );
        return {
          error: `AI輸出因達到最大token限制而被截斷 (MAX_TOKENS). Candidates Tokens: ${
            usageMetadata?.candidatesTokenCount || "N/A"
          }`,
          type: "MAX_TOKENS",
          rawOutput: responseText ?? undefined,
        };
      }
      if (finishReason === "SAFETY") {
        console.error(
          `[${JOB_NAME}-Gemini] CRITICAL: Output was STOPPED due to SAFETY settings.`
        );
        return {
          error: `AI輸出因安全設定而被終止 (SAFETY). Ratings: ${JSON.stringify(
            safetyRatings
          )}`,
          type: "SAFETY",
          rawOutput: responseText ?? undefined,
        };
      }
      if (responseText === null || responseText.trim() === "") {
        console.error(
          `[${JOB_NAME}-Gemini] Response text is null or empty even if finishReason was ${finishReason}.`
        );
        return {
          error: "Gemini 回應文本為空或無法提取",
          type: "EMPTY_RESPONSE",
          rawOutput: responseText ?? undefined,
        };
      }

      try {
        const cleanedText = responseText
          .replace(/^```json\s*|```\s*$/g, "")
          .trim();
        if (cleanedText.length === 0) {
          console.error(
            `[${JOB_NAME}-Gemini] Cleaned text is empty after removing markdown fences.`
          );
          return {
            error: "AI輸出清理後為空 (可能是純 ```json ``` 格式錯誤)",
            type: "EMPTY_RESPONSE",
            rawOutput: responseText,
          };
        }
        const jsonResult: AnalysisResultJson = JSON.parse(cleanedText);

        contentSeemsTruncatedByEllipsis = false;
        if (finishReason === "STOP") {
          checkForEllipsisTruncation(jsonResult);
        }

        if (contentSeemsTruncatedByEllipsis) {
          console.error(
            `[${JOB_NAME}-Gemini] CRITICAL: Output FINISHED WITH STOP, but content appears TRUNCATED with ellipsis.`
          );
          return {
            error:
              "AI輸出內容疑似被不自然的省略號截斷，即使 FinishReason 為 STOP",
            type: "CONTENT_ELLIPSIS_TRUNCATION",
            rawOutput: responseText,
            parsedResult: jsonResult,
          };
        }

        if (
          jsonResult &&
          typeof jsonResult === "object" &&
          typeof jsonResult.summary_title === "string" &&
          typeof jsonResult.overall_summary_sentence === "string" &&
          "committee_name" in jsonResult &&
          Array.isArray(jsonResult.agenda_items)
        ) {
          console.log(
            `[${JOB_NAME}-Gemini] Analysis successful (JSON parsed and basic structure validated).`
          );
          return jsonResult;
        } else {
          console.warn(
            `[${JOB_NAME}-Gemini] Parsed JSON lacks expected structure/types.`
          );
          return {
            error: "AI輸出的JSON結構不符合預期 (缺少必要欄位或類型錯誤)",
            type: "INVALID_STRUCTURE",
            rawOutput: cleanedText,
          };
        }
      } catch (parseError) {
        console.error(
          `[${JOB_NAME}-Gemini] JSON Parse Error: ${
            parseError.message
          }. Position: ${parseError.at ?? "N/A"}`
        );
        console.error(
          `[${JOB_NAME}-Gemini] Raw Cleaned Text (first 500 + last 500 chars) that failed parsing:\nSTART>>>${responseText
            ?.replace(/^```json\s*|```\s*$/g, "")
            .trim()
            .substring(0, 500)}\n...\nEND>>>${responseText
            ?.replace(/^```json\s*|```\s*$/g, "")
            .trim()
            .slice(-500)}`
        );
        return {
          error: `AI未按要求輸出有效JSON (解析錯誤): ${parseError.message}`,
          type: "JSON_PARSE_ERROR",
          rawOutput: responseText?.replace(/^```json\s*|```\s*$/g, "").trim(),
        };
      }
    } else {
      console.error(
        `[${JOB_NAME}-Gemini] No 'response' object in Gemini result.`
      );
      return {
        error: "Gemini API 未返回有效的 response 物件",
        type: "EMPTY_RESPONSE",
      };
    }
  } catch (error) {
    console.error(`[${JOB_NAME}-Gemini] Outer API Call Error:`, error);
    let errorMessage = `Gemini API 呼叫失敗: ${error.message || String(error)}`;
    if (error.message?.includes("SAFETY"))
      errorMessage = `內容或回應觸發安全規則: ${error.message}`;
    else if (
      error.message?.includes("fetch failed") ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNREFUSED"
    )
      errorMessage = `網路錯誤，無法連接 Gemini API: ${error.message}`;
    else if (error.message?.includes("API key not valid"))
      errorMessage = `Gemini API 金鑰無效: ${error.message}`;
    else if (
      error.message?.includes("Deadline exceeded") ||
      error.message?.includes("timeout")
    )
      errorMessage = `Gemini API 呼叫超時: ${error.message}`;
    else if (error.status && error.statusText) {
      errorMessage = `Gemini API HTTP Error ${error.status}: ${error.statusText}. Details: ${error.message}`;
    }
    return { error: errorMessage, type: "API_CALL_ERROR" };
  }
}
