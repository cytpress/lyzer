// supabase/functions/analyze-pending-agendas/index.ts
// << 此文件內容與上一個回覆中的版本完全相同，無需修改 >>
// << 為了完整性，再次貼出 >>

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2"; // 只導入類型
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "npm:@google/generative-ai";
import {
  fetchWithRetry,
  FETCH_DELAY_MS,
  getSupabaseClient,
  AnalysisResultJson, // 引入 JSON 類型
  AnalysisErrorJson, // 引入錯誤 JSON 類型
  // GazetteAgendaRecord // 如果需要在本檔案中直接引用完整記錄類型
} from "../_shared/utils.ts";
import { getAnalysisPrompt, shouldSkipAnalysis } from "../_shared/prompts.ts";

// --- Configuration ---
const JOB_NAME = "analyze-pending-agendas";
const GEMINI_MODEL_NAME = "gemini-2.5-pro-exp-03-25"; // 建議使用支援 JSON 模式的新模型
const MAX_CONTENT_LENGTH_CHARS = 11000000; // 可根據模型調整
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // 每次運行處理的議程數量上限 (可調整)
const DB_FETCH_LIMIT = 10; // 每次從 DB 抓取的議程數量 (可調整)
const CONTENT_FETCH_TIMEOUT_MS = 45000; // 抓取議程內容的超時時間 (毫秒)

// --- Gemini Generation Config ---
const generationConfig = {
  temperature: 0.3,
  maxOutputTokens: 8192, // 確保足夠輸出 JSON
  responseMimeType: "application/json", // <<< 強烈建議，要求 JSON 輸出
};

// --- Gemini Safety Settings ---
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

// --- Gemini Analysis Helper ---
async function analyzeWithGemini(
  prompt: string,
  apiKey: string
): Promise<AnalysisResultJson | AnalysisErrorJson> {
  // 返回物件

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      safetySettings: safetySettings,
    });

    console.log(
      `[${JOB_NAME}-Gemini] Requesting analysis from ${GEMINI_MODEL_NAME} with config:`,
      JSON.stringify(generationConfig)
    );

    // --- 呼叫 generateContent ---
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: generationConfig,
    });

    // --- 處理回應 ---
    const response = result.response;
    if (!response) {
      if (result.promptFeedback?.blockReason) {
        const reason = result.promptFeedback.blockReason;
        const message = result.promptFeedback.blockReasonMessage || "N/A";
        console.error(
          `[${JOB_NAME}-Gemini] Prompt blocked due to: ${reason}. Message: ${message}`
        );
        return { error: `請求觸發 ${reason} 規則而被阻擋` };
      }
      console.error(`[${JOB_NAME}-Gemini] No response received from Gemini.`);
      return { error: "Gemini 未返回有效回應" };
    }

    if (response.promptFeedback?.blockReason) {
      const reason = response.promptFeedback.blockReason;
      const message = response.promptFeedback.blockReasonMessage || "N/A";
      console.error(
        `[${JOB_NAME}-Gemini] Response blocked due to: ${reason}. Message: ${message}`
      );
      return { error: `回應觸發 ${reason} 規則而被阻擋` };
    }

    if (
      !response.candidates ||
      response.candidates.length === 0 ||
      !response.candidates[0].content?.parts?.[0]?.text
    ) {
      console.error(
        `[${JOB_NAME}-Gemini] Gemini response is empty or missing text content.`
      );
      console.error(
        `[${JOB_NAME}-Gemini] Full response object (partial):`,
        JSON.stringify(response, null, 2).substring(0, 1000)
      );
      return { error: "Gemini 返回了空的回應或缺少文本內容" };
    }

    const responseText = response.text
      ? response.text()
      : response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!responseText) {
      console.error(
        `[${JOB_NAME}-Gemini] Could not extract text from Gemini response.`
      );
      return { error: "無法從 Gemini 回應中提取文本" };
    }

    // 嘗試解析 JSON
    try {
      // --- <<< 新增: 清理可能的 Markdown JSON 區塊標記 >>> ---
      const cleanedText = responseText
        .replace(/^```json\s*|```\s*$/g, "")
        .trim();
      // --- <<< 清理結束 >>> ---

      const jsonResult: AnalysisResultJson = JSON.parse(cleanedText); // 使用清理後的文本解析
      if (
        jsonResult &&
        typeof jsonResult === "object" &&
        (jsonResult.overall_summary_sentence ||
          jsonResult.agenda_items?.length === 0)
      ) {
        console.log(`[${JOB_NAME}-Gemini] Analysis successful (JSON parsed).`);
        return jsonResult;
      } else {
        console.warn(
          `[${JOB_NAME}-Gemini] Parsed JSON is missing expected structure.`
        );
        console.warn(
          `[${JOB_NAME}-Gemini] Cleaned text was:`,
          cleanedText.substring(0, 500)
        );
        return { error: "AI輸出的JSON結構不符合預期" };
      }
    } catch (parseError) {
      console.error(
        `[${JOB_NAME}-Gemini] Failed to parse Gemini response as JSON: ${parseError.message}`
      );
      console.error(
        `[${JOB_NAME}-Gemini] Raw response text (after potential cleaning):`,
        responseText.substring(0, 500)
      ); // 仍然打印原始的方便對比
      return { error: `AI未按要求輸出有效的JSON格式: ${parseError.message}` };
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}-Gemini] Error during Gemini API call or setup:`,
      error
    );
    let errorMessage = `Gemini API 呼叫失敗: ${error.message}`;
    if (
      error.message?.includes("SAFETY") ||
      error.message?.includes("blocked")
    ) {
      errorMessage = `內容或回應觸發安全過濾規則: ${error.message}`;
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      errorMessage = `網路錯誤，無法連接 Gemini API: ${error.message}`;
    }
    return { error: errorMessage };
  }
}

// --- Process Single Agenda Analysis Helper ---
async function processSingleAgenda(
  agenda: {
    agenda_id: string;
    parsed_content_url: string;
    category_code: number | null;
  },
  supabase: SupabaseClient,
  geminiApiKey: string
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  errorMessageForLog?: string;
  resultObjectToStore: AnalysisResultJson | AnalysisErrorJson;
}> {
  const { agenda_id, parsed_content_url, category_code } = agenda;
  let analysisResultObject: AnalysisResultJson | AnalysisErrorJson;
  let finalStatus: "completed" | "failed" = "failed";
  let analysisPerformed = false;
  let errorMessageForLog: string | undefined = undefined;

  console.log(
    `\n[${JOB_NAME}] Processing Agenda ID: ${agenda_id}, Category: ${category_code}`
  );

  // --- 檢查是否應跳過 ---
  if (shouldSkipAnalysis(category_code)) {
    console.log(
      `[${JOB_NAME}] Agenda ${agenda_id} category (${category_code}) should be skipped.`
    );
    analysisResultObject = { error: "此類別無需摘要 (例如 索引、未知類別)" };
    finalStatus = "completed";
    try {
      await supabase
        .from("gazette_agendas")
        .update({
          analysis_status: finalStatus,
          analysis_result: analysisResultObject, // 直接傳遞物件
          analyzed_at: new Date().toISOString(),
        })
        .eq("agenda_id", agenda_id);
      console.log(
        `[${JOB_NAME}] Marked skipped agenda ${agenda_id} as completed in DB.`
      );
    } catch (e) {
      console.error(
        `[${JOB_NAME}] !!! CRITICAL: Exception during status update for skipped agenda ${agenda_id}: ${e.message}`
      );
    }
    return {
      success: true,
      analysisPerformed: false,
      resultObjectToStore: analysisResultObject,
    };
  }

  // --- 需要分析的流程 ---
  let contentText: string = "";
  let truncated = false;
  try {
    // 1. Mark as processing
    console.log(`[${JOB_NAME}] Marking ${agenda_id} as 'processing'...`);
    const { error: updateProcessingError } = await supabase
      .from("gazette_agendas")
      .update({ analysis_status: "processing" })
      .eq("agenda_id", agenda_id);
    if (updateProcessingError) {
      console.warn(
        `[${JOB_NAME}] Failed to mark ${agenda_id} as processing: ${updateProcessingError.message}`
      );
    }

    // 2. Fetch content
    console.log(`[${JOB_NAME}] Fetching content from: ${parsed_content_url}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CONTENT_FETCH_TIMEOUT_MS
      );
      const contentResponse = await fetchWithRetry(
        parsed_content_url,
        { signal: controller.signal },
        2,
        `${JOB_NAME}-contentFetch`
      );
      clearTimeout(timeoutId);
      contentText = await contentResponse.text();

      if (contentText.length > MAX_CONTENT_LENGTH_CHARS) {
        console.warn(
          `[${JOB_NAME}] Content for ${agenda_id} length (${contentText.length}) > ${MAX_CONTENT_LENGTH_CHARS}, truncating.`
        );
        contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
        truncated = true;
      }
      console.log(
        `[${JOB_NAME}] Fetched content successfully for ${agenda_id} (${(
          contentText.length / 1024
        ).toFixed(1)} KB).${truncated ? " Content was truncated." : ""}`
      );
    } catch (fetchError) {
      if (fetchError.name === "AbortError") {
        errorMessageForLog = `Content fetch timed out after ${CONTENT_FETCH_TIMEOUT_MS}ms.`;
      } else {
        errorMessageForLog = `Error fetching content: ${fetchError.message}`;
      }
      console.error(`[${JOB_NAME}] ${errorMessageForLog} for ${agenda_id}.`);
      throw new Error(errorMessageForLog);
    }

    if (!contentText || contentText.trim().length === 0) {
      errorMessageForLog = "Fetched content is empty.";
      console.warn(
        `[${JOB_NAME}] ${errorMessageForLog} for ${agenda_id}. Skipping analysis.`
      );
      throw new Error(errorMessageForLog);
    }

    // 3. Analyze content
    console.log(
      `[${JOB_NAME}] Analyzing content for ${agenda_id} (Category: ${category_code}) with Gemini...`
    );
    const prompt = getAnalysisPrompt(category_code, contentText, truncated);
    analysisResultObject = await analyzeWithGemini(prompt, geminiApiKey);
    analysisPerformed = true;

    if (analysisResultObject && !("error" in analysisResultObject)) {
      finalStatus = "completed";
      console.log(`[${JOB_NAME}] Analysis successful for ${agenda_id}.`);
    } else {
      finalStatus = "failed";
      errorMessageForLog =
        (analysisResultObject as AnalysisErrorJson)?.error ||
        "Gemini analysis failed or returned invalid object.";
      console.warn(`[${JOB_NAME}] ${errorMessageForLog} for ${agenda_id}.`);
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Error during processing pipeline for ${agenda_id}: ${error.message}`
    );
    finalStatus = "failed";
    errorMessageForLog =
      errorMessageForLog || `Processing pipeline error: ${error.message}`;
    analysisResultObject = { error: errorMessageForLog };
  } finally {
    // 4. Update final status in Supabase ALWAYS
    console.log(
      `[${JOB_NAME}] Updating final status for ${agenda_id} to: ${finalStatus}`
    );
    const resultToStore: AnalysisResultJson | AnalysisErrorJson =
      analysisResultObject ?? { error: "Unknown processing error occurred" };

    const updatePayload: {
      analysis_status: "completed" | "failed";
      analysis_result: AnalysisResultJson | AnalysisErrorJson;
      analyzed_at: string | null;
    } = {
      analysis_status: finalStatus,
      analysis_result: resultToStore, // 直接傳遞 JS 物件
      analyzed_at:
        finalStatus === "completed" && !("error" in resultToStore)
          ? new Date().toISOString()
          : null,
    };

    try {
      const { error: updateAnalysisError } = await supabase
        .from("gazette_agendas")
        .update(updatePayload)
        .eq("agenda_id", agenda_id);

      if (updateAnalysisError) {
        console.error(
          `[${JOB_NAME}] !!! CRITICAL: Failed to update final status for ${agenda_id}: ${updateAnalysisError.message}`
        );
        errorMessageForLog = errorMessageForLog
          ? `${errorMessageForLog}; DB update failed.`
          : `DB update failed: ${updateAnalysisError.message}`;
      } else {
        console.log(`[${JOB_NAME}] Final status updated for ${agenda_id}.`);
      }
    } catch (updateException) {
      console.error(
        `[${JOB_NAME}] !!! CRITICAL: Exception during final status update for ${agenda_id}: ${updateException.message}`
      );
      errorMessageForLog = errorMessageForLog
        ? `${errorMessageForLog}; DB update exception.`
        : `DB update exception: ${updateException.message}`;
    }
  }

  return {
    success:
      finalStatus === "completed" && !("error" in (analysisResultObject ?? {})),
    analysisPerformed,
    errorMessageForLog: errorMessageForLog,
    resultObjectToStore: analysisResultObject ?? {
      error: "Final result object was unexpectedly null",
    },
  };
}

// --- Main Server Handler ---
serve(async (req) => {
  const startTime = Date.now();
  let geminiAnalysesAttempted = 0;
  let successfulAnalysesCount = 0;
  let failedProcessingCount = 0;
  let agendasCheckedCount = 0;
  let skippedCategoryCount = 0;

  const supabase = getSupabaseClient();
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error(`[${JOB_NAME}] Missing GEMINI_API_KEY environment variable!`);
    return new Response(
      JSON.stringify({ success: false, message: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(`[${JOB_NAME}] Function execution started.`);

  try {
    // 1. Fetch pending or previously failed agendas
    console.log(
      `[${JOB_NAME}] Fetching up to ${DB_FETCH_LIMIT} agendas with status 'pending' or 'failed' and a valid txt URL...`
    );
    const { data: agendasToProcess, error: fetchError } = await supabase
      .from("gazette_agendas")
      .select("agenda_id, parsed_content_url, category_code")
      .in("analysis_status", ["pending", "failed"])
      .not("parsed_content_url", "is", null)
      .order("fetched_at", { ascending: true })
      .limit(DB_FETCH_LIMIT);

    if (fetchError) {
      console.error(
        `[${JOB_NAME}] Error fetching agendas: ${fetchError.message}`
      );
      throw new Error(`Error fetching agendas: ${fetchError.message}`);
    }

    if (!agendasToProcess || agendasToProcess.length === 0) {
      console.log(`[${JOB_NAME}] No suitable agendas found to process.`);
      const duration = (Date.now() - startTime) / 1000;
      return new Response(
        JSON.stringify({
          success: true,
          message: `No agendas to process. Duration: ${duration.toFixed(2)}s.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[${JOB_NAME}] Found ${agendasToProcess.length} agendas to potentially process.`
    );

    // 2. Process each agenda sequentially
    for (const agenda of agendasToProcess) {
      agendasCheckedCount++;

      // Check analysis limit before processing non-skippable items
      if (!shouldSkipAnalysis(agenda.category_code)) {
        if (geminiAnalysesAttempted >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
          console.log(
            `[${JOB_NAME}] Reached Gemini analysis limit (${GEMINI_ANALYSIS_LIMIT_PER_RUN}). Skipping further analysis for agenda ${agenda.agenda_id} in this run.`
          );
          continue; // Go to the next agenda item
        }
      }

      // Process the agenda item
      const result = await processSingleAgenda(agenda, supabase, geminiApiKey);

      // Update counters based on the result
      if (result.analysisPerformed) {
        geminiAnalysesAttempted++;
      }
      if (shouldSkipAnalysis(agenda.category_code)) {
        skippedCategoryCount++;
      }

      if (result.success) {
        successfulAnalysesCount++;
      } else {
        if (!shouldSkipAnalysis(agenda.category_code)) {
          failedProcessingCount++;
        }
      }

      // Optional delay between processing items
      if (agendasCheckedCount < agendasToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
      }
    } // End agenda processing loop
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Log summary and return success
  const duration = (Date.now() - startTime) / 1000;
  const summary =
    `Checked ${agendasCheckedCount} DB rows. ` +
    `Skipped ${skippedCategoryCount} agendas by category. ` +
    `Attempted ${geminiAnalysesAttempted} Gemini analyses ` +
    `(${successfulAnalysesCount} successful, ${failedProcessingCount} failed). ` +
    `Duration: ${duration.toFixed(2)}s.`;
  console.log(`[${JOB_NAME}] Run finished. ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
