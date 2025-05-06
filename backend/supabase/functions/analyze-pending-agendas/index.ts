// supabase/functions/analyze-pending-contents/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "npm:@google/generative-ai";
import {
  fetchWithRetry,
  FETCH_DELAY_MS,
  getSupabaseClient,
  AnalysisResultJson, // AI 成功輸出的結構
  AnalysisErrorJson, // AI 或流程失敗輸出的結構
  AnalyzedContentRecord, // analyzed_contents 表的記錄類型
} from "../_shared/utils.ts"; // 確認路徑正確
import { getAnalysisPrompt, shouldSkipAnalysis } from "../_shared/prompts.ts"; // 確認路徑正確

// --- Configuration ---
const JOB_NAME = "analyze-pending-contents"; // 工作名稱
const GEMINI_MODEL_NAME = "gemini-2.5-pro-exp-03-25"; // 推薦使用 Flash 或 Pro for JSON mode
const MAX_CONTENT_LENGTH_CHARS = 1000000; // 根據模型調整 (Flash 約 1M token)
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // <<< 每次運行只分析 1 個 (根據你的要求) >>>
const DB_FETCH_LIMIT = 10; // 每次從 DB 抓取多少待處理 URL
const CONTENT_FETCH_TIMEOUT_MS = 60000; // 抓取內容的超時 (60秒)

// --- Gemini Generation Config ---
const generationConfig = {
  temperature: 0.3, // 低溫，追求穩定
  maxOutputTokens: 100000, // 確保足夠輸出 JSON
  responseMimeType: "application/json", // <<< 強制要求 JSON 輸出 >>>
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
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      safetySettings: safetySettings,
    });

    console.log(
      `[${JOB_NAME}-Gemini] Requesting analysis from ${GEMINI_MODEL_NAME}...`
    );

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: generationConfig,
    });

    const response = result.response;

    // --- 錯誤處理 ---
    if (!response) {
      const blockReason = result.promptFeedback?.blockReason;
      if (blockReason) {
        const message = result.promptFeedback.blockReasonMessage || "N/A";
        console.error(
          `[${JOB_NAME}-Gemini] Prompt blocked: ${blockReason}. ${message}`
        );
        return { error: `請求觸發 ${blockReason} 規則而被阻擋` };
      }
      console.error(`[${JOB_NAME}-Gemini] No response received.`);
      return { error: "Gemini 未返回有效回應" };
    }
    const responseBlockReason = response.promptFeedback?.blockReason;
    if (responseBlockReason) {
      const message = response.promptFeedback.blockReasonMessage || "N/A";
      console.error(
        `[${JOB_NAME}-Gemini] Response blocked: ${responseBlockReason}. ${message}`
      );
      return { error: `回應觸發 ${responseBlockReason} 規則而被阻擋` };
    }

    const responseText = response.text(); // 嘗試獲取文本
    if (!responseText) {
      console.error(
        `[${JOB_NAME}-Gemini] Could not extract text. Candidates:`,
        JSON.stringify(response.candidates || "N/A").substring(0, 500)
      );
      return { error: "無法從 Gemini 回應中提取文本" };
    }

    // --- 解析 JSON ---
    try {
      const cleanedText = responseText
        .replace(/^```json\s*|```\s*$/g, "")
        .trim();
      const jsonResult: AnalysisResultJson = JSON.parse(cleanedText);

      // 進行更嚴格的結構驗證
      if (
        jsonResult &&
        typeof jsonResult === "object" &&
        typeof jsonResult.summary_title === "string" &&
        typeof jsonResult.overall_summary_sentence === "string" &&
        "committee_name" in jsonResult && // 檢查 key 存在
        Array.isArray(jsonResult.agenda_items) // 檢查 agenda_items 是陣列
      ) {
        // 可以進一步驗證 agenda_items 內部結構，如果需要
        console.log(
          `[${JOB_NAME}-Gemini] Analysis successful (JSON parsed and basic structure validated).`
        );
        return jsonResult; // 返回驗證後的成功結果
      } else {
        console.warn(
          `[${JOB_NAME}-Gemini] Parsed JSON lacks expected structure/types.`
        );
        console.warn(
          `[${JOB_NAME}-Gemini] Cleaned text (start):`,
          cleanedText.substring(0, 500)
        );
        return { error: "AI輸出的JSON結構不符合預期 (缺少必要欄位或類型錯誤)" };
      }
    } catch (parseError) {
      console.error(
        `[${JOB_NAME}-Gemini] JSON Parse Error: ${parseError.message}`
      );
      console.error(
        `[${JOB_NAME}-Gemini] Raw Cleaned Text (start):`,
        responseText
          .replace(/^```json\s*|```\s*$/g, "")
          .trim()
          .substring(0, 500)
      );
      return { error: `AI未按要求輸出有效JSON: ${parseError.message}` };
    }
  } catch (error) {
    console.error(`[${JOB_NAME}-Gemini] API Call Error:`, error);
    let errorMessage = `Gemini API 呼叫失敗: ${error.message}`;
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
    else if (error.message?.includes("Deadline exceeded"))
      errorMessage = `Gemini API 呼叫超時: ${error.message}`;
    return { error: errorMessage };
  }
}

// --- Process Single Analyzed Content Helper ---
async function processSingleAnalyzedContent(
  contentRecord: Pick<AnalyzedContentRecord, "id" | "parsed_content_url">,
  supabase: SupabaseClient,
  geminiApiKey: string
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  errorMessageForLog?: string;
  resultObjectStored: AnalysisResultJson | AnalysisErrorJson;
}> {
  const { id: analyzedContentId, parsed_content_url } = contentRecord;
  const uniqueRunId = Math.random().toString(36).substring(2, 8); // 每次調用生成唯一ID用於日誌追蹤
  console.log(
    `[${JOB_NAME}] START Processing Content ID: ${analyzedContentId} (Run: ${uniqueRunId}), URL: ${parsed_content_url}`
  );

  let analysisResultObject: AnalysisResultJson | AnalysisErrorJson | undefined; // 初始化為 undefined
  let finalStatus: "completed" | "failed" = "failed"; // 預設失敗
  let finalCommitteeName: string | null = null;
  let analysisPerformed = false; // 標記是否實際調用了 AI
  let errorMessageForLog: string | undefined = undefined;
  let categoryCodeForPrompt: number | null = null; // 用於生成 Prompt 的輔助信息

  try {
    // --- 0. 獲取關聯的 Category Code ---
    console.log(
      `[${JOB_NAME}] Fetching representative category_code for URL (Run: ${uniqueRunId})...`
    );
    const { data: representativeAgenda, error: categoryLookupError } =
      await supabase
        .from("gazette_agendas")
        .select("category_code")
        .eq("parsed_content_url", parsed_content_url) // 根據 URL 查找
        .limit(1) // 只需要一個
        .maybeSingle(); // 可能找不到

    if (categoryLookupError) {
      // 數據庫查詢出錯，記錄警告但繼續，只是 Prompt 可能不準確
      console.warn(
        `[${JOB_NAME}] Warn: DB error fetching category_code (Run: ${uniqueRunId}): ${categoryLookupError.message}. Proceeding without category hint.`
      );
    } else if (representativeAgenda) {
      categoryCodeForPrompt = representativeAgenda.category_code;
      console.log(
        `[${JOB_NAME}] Using category_code ${categoryCodeForPrompt} for prompt generation (Run: ${uniqueRunId}).`
      );
    } else {
      // 找不到關聯的議程，這比較奇怪，記錄錯誤
      console.error(
        `[${JOB_NAME}] !! ERROR: No associated agenda found for URL ${parsed_content_url} (Run: ${uniqueRunId})! Cannot determine category_code.`
      );
      categoryCodeForPrompt = null; // 設為 null，讓 Prompt 使用預設邏輯
    }

    // --- 1. 檢查是否應根據 Category Code 跳過分析 ---
    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME}] Skipping Content ID ${analyzedContentId} (Category: ${categoryCodeForPrompt}, Run: ${uniqueRunId}).`
      );
      analysisResultObject = { error: "此類別無需摘要 (例如 索引、未知類別)" };
      finalStatus = "completed"; // 跳過也算完成處理
      finalCommitteeName = null;
      analysisPerformed = false;
      // 不需要 throw，流程會直接進入 finally 更新狀態
    } else {
      // --- 需要進行分析的流程 ---
      let contentText: string = "";
      let truncated = false;

      // 2. 將狀態標記為 'processing'
      await supabase
        .from("analyzed_contents")
        .update({ analysis_status: "processing" })
        .eq("id", analyzedContentId);
      console.log(
        `[${JOB_NAME}] Marked Content ID ${analyzedContentId} as 'processing' (Run: ${uniqueRunId}).`
      );

      // 3. 抓取議程內容文本
      console.log(
        `[${JOB_NAME}] Fetching content (Run: ${uniqueRunId}): ${parsed_content_url}`
      );
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

        // 檢查並截斷過長內容
        if (contentText.length > MAX_CONTENT_LENGTH_CHARS) {
          console.warn(
            `[${JOB_NAME}] Truncating content (Run: ${uniqueRunId}) for ${analyzedContentId} (${contentText.length} > ${MAX_CONTENT_LENGTH_CHARS}).`
          );
          contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
          truncated = true;
        }
        console.log(
          `[${JOB_NAME}] Fetched content (Run: ${uniqueRunId}) for URL (${(
            contentText.length / 1024
          ).toFixed(1)} KB)${truncated ? " [Truncated]" : ""}.`
        );
      } catch (fetchError) {
        errorMessageForLog =
          fetchError.name === "AbortError"
            ? `內容抓取超時 (${(CONTENT_FETCH_TIMEOUT_MS / 1000).toFixed(0)}秒)`
            : `內容抓取錯誤: ${fetchError.message}`;
        console.error(
          `[${JOB_NAME}] ${errorMessageForLog} (Run: ${uniqueRunId}) for URL ${parsed_content_url}.`
        );
        throw new Error(errorMessageForLog); // 拋出錯誤，中斷後續分析
      }
      // 檢查內容是否為空
      if (!contentText || contentText.trim().length === 0) {
        errorMessageForLog = "抓取的內容為空";
        console.warn(
          `[${JOB_NAME}] ${errorMessageForLog} (Run: ${uniqueRunId}) for URL ${parsed_content_url}.`
        );
        throw new Error(errorMessageForLog); // 拋出錯誤
      }

      // 4. 使用 Gemini 分析內容
      console.log(
        `[${JOB_NAME}] Analyzing content (Run: ${uniqueRunId}) for URL (Category Hint: ${categoryCodeForPrompt}) with Gemini...`
      );
      const prompt = getAnalysisPrompt(
        categoryCodeForPrompt,
        contentText,
        truncated
      ); // 傳入 category code 生成 prompt
      analysisResultObject = await analyzeWithGemini(prompt, geminiApiKey);
      analysisPerformed = true; // 標記已執行分析

      // 處理分析結果
      if (analysisResultObject && !("error" in analysisResultObject)) {
        // 分析成功
        finalStatus = "completed";
        // 提取 committee_name，如果 AI 沒返回或格式錯誤則為 null
        finalCommitteeName =
          typeof analysisResultObject.committee_name === "string"
            ? analysisResultObject.committee_name
            : null;
        console.log(
          `[${JOB_NAME}] Analysis successful (Run: ${uniqueRunId}) for URL. Committee: ${
            finalCommitteeName ?? "N/A"
          }.`
        );

        // 可選的委員會名稱驗證
        const validCommittees = [
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
          "經費稽核委員會",
          "修憲委員會",
          "立法院院會",
          "黨團協商",
          "其他",
        ];
        if (
          finalCommitteeName &&
          !validCommittees.includes(finalCommitteeName)
        ) {
          console.warn(
            `[${JOB_NAME}] Warning (Run: ${uniqueRunId}): Unexpected committee name "${finalCommitteeName}" from AI for URL ${parsed_content_url}. Storing anyway.`
          );
        }
        // 檢查 AI 是否返回了非 null 但非 string 的 committee_name
        if (
          finalCommitteeName === null &&
          analysisResultObject.committee_name !== null
        ) {
          console.warn(
            `[${JOB_NAME}] Warning (Run: ${uniqueRunId}): AI returned non-string or missing committee_name for URL ${parsed_content_url}. Received:`,
            JSON.stringify(analysisResultObject.committee_name)
          );
        }
      } else {
        // 分析失敗
        finalStatus = "failed";
        finalCommitteeName = null; // 分析失敗則無委員會名稱
        errorMessageForLog =
          (analysisResultObject as AnalysisErrorJson)?.error ||
          "Gemini 分析失敗或返回無效物件";
        console.warn(
          `[${JOB_NAME}] ${errorMessageForLog} (Run: ${uniqueRunId}) for URL ${parsed_content_url}.`
        );
        // analysisResultObject 已經是包含錯誤信息的物件了
      }
    } // 結束 else (需要分析的流程)
  } catch (error) {
    // 捕捉整個流程中的錯誤 (例如內容抓取失敗、分析失敗等)
    console.error(
      `[${JOB_NAME}] Pipeline Error (Run: ${uniqueRunId}) for Content ID ${analyzedContentId}: ${error.message}`
    );
    finalStatus = "failed"; // 確保狀態為 failed
    finalCommitteeName = null;
    errorMessageForLog = errorMessageForLog || `處理流程錯誤: ${error.message}`; // 保留之前的錯誤信息或設置新的
    // 確保 analysisResultObject 是一個錯誤物件，即使之前可能已賦值
    if (
      analysisResultObject === undefined ||
      !("error" in analysisResultObject)
    ) {
      analysisResultObject = { error: errorMessageForLog };
    }
  } finally {
    // --- 5. 無論成功或失敗，總是更新 analyzed_contents 表的記錄 ---
    console.log(
      `[${JOB_NAME}] Preparing DB Update for ${analyzedContentId} (Run: ${uniqueRunId}, Status: ${finalStatus}).`
    );

    // 確保 resultToStore 有值，至少是一個錯誤物件
    const resultToStore: AnalysisResultJson | AnalysisErrorJson =
      analysisResultObject ?? {
        error: `未知的處理錯誤發生 (Run: ${uniqueRunId})`,
      }; // 添加後備錯誤

    // <<< 加入詳細的調試日誌 >>>
    console.log(
      `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Final status to store: ${finalStatus}`
    );
    console.log(
      `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Final committee name to store: ${finalCommitteeName}`
    );
    console.log(
      `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Result object type to store: ${typeof resultToStore}`
    );
    if (typeof resultToStore === "object" && resultToStore !== null) {
      console.log(
        `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Result object has 'error' key: ${
          "error" in resultToStore
        }`
      );
    }

    try {
      const jsonString = JSON.stringify(resultToStore);
      const stringLength = jsonString.length;
      console.log(
        `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Stringified result length: ${stringLength}`
      );
      // 打印頭尾進行快速檢查，判斷是否看起來完整
      if (stringLength > 400) {
        console.log(
          `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Stringified result start: ${jsonString.substring(
            0,
            200
          )}`
        );
        console.log(
          `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Stringified result end: ${jsonString.slice(
            -200
          )}`
        );
      } else {
        console.log(
          `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Stringified result full: ${jsonString}`
        );
      }
      // 檢查結尾是否是 '}' 或 ']' (對於非空 JSON)
      if (
        stringLength > 0 &&
        !jsonString.endsWith("}") &&
        !jsonString.endsWith("]")
      ) {
        console.warn(
          `[${JOB_NAME}] WARNING (Run: ${uniqueRunId}): Stringified result does not end with '}' or ']'. Possible truncation or invalid JSON from AI?`
        );
      }
    } catch (stringifyError) {
      console.error(
        `[${JOB_NAME}] DEBUG (Run: ${uniqueRunId}): Error stringifying resultToStore: ${stringifyError.message}`
      );
      // 如果無法字串化，嘗試打印原始物件的部分內容（小心可能過大）
      // console.log(`[${JOB_NAME}] DEBUG: resultToStore object (partial):`, util.inspect(resultToStore, { depth: 1 }));
    }
    // <<< 調試日誌結束 >>>

    // 準備更新資料庫的 Payload
    const updatePayload: Partial<AnalyzedContentRecord> = {
      analysis_status: finalStatus,
      analysis_result: resultToStore, // 直接傳遞 JS 物件，Supabase Client 會處理序列化
      analyzed_at:
        finalStatus === "completed" && !("error" in resultToStore)
          ? new Date().toISOString() // 只有成功完成才記錄分析時間
          : null,
      committee_name: finalCommitteeName, // 存儲提取或預設的委員會名稱
    };

    console.log(
      `[${JOB_NAME}] Executing DB update for Content ID ${analyzedContentId} (Run: ${uniqueRunId})...`
    );
    try {
      // 更新 analyzed_contents 表
      const { error: updateError } = await supabase
        .from("analyzed_contents")
        .update(updatePayload)
        .eq("id", analyzedContentId); // 使用 analyzed_contents 的主鍵

      if (updateError) {
        // 記錄數據庫更新錯誤
        console.error(
          `[${JOB_NAME}] !!! DB Update Error (Run: ${uniqueRunId}): ${updateError.message} for Content ID ${analyzedContentId}`
        );
        // 將錯誤信息附加到日誌中，但不改變函數返回值（因為流程已執行完）
        errorMessageForLog = `${
          errorMessageForLog || "Unknown Error"
        }; DB Update Failed: ${updateError.message}`;
        finalStatus = "failed"; // 確保最終狀態是 failed
      } else {
        console.log(
          `[${JOB_NAME}] DB updated successfully for Content ID ${analyzedContentId} (Run: ${uniqueRunId}).`
        );
      }
    } catch (updateEx) {
      // 捕捉數據庫更新時可能發生的異常
      console.error(
        `[${JOB_NAME}] !!! DB Update Exception (Run: ${uniqueRunId}): ${updateEx.message} for Content ID ${analyzedContentId}`
      );
      errorMessageForLog = `${
        errorMessageForLog || "Unknown Error"
      }; DB Update Exception: ${updateEx.message}`;
      finalStatus = "failed"; // 確保最終狀態是 failed
    }
    console.log(
      `[${JOB_NAME}] END Processing Content ID: ${analyzedContentId} (Run: ${uniqueRunId})`
    );
    // --- DB 更新結束 ---
  } // finally 結束

  // 返回處理結果
  return {
    // 成功條件：最終狀態是 completed 且結果物件中沒有 error 鍵
    success:
      finalStatus === "completed" &&
      !(analysisResultObject && "error" in analysisResultObject),
    analysisPerformed, // 返回是否調用了 AI
    errorMessageForLog: errorMessageForLog, // 返回過程中的錯誤日誌（如果有的話）
    resultObjectStored: analysisResultObject ?? { error: "最終結果物件為空" }, // 返回最終存儲的物件
  };
}

// --- Main Server Handler ---
serve(async (req) => {
  const startTime = Date.now();
  let geminiAnalysesAttempted = 0; // 實際調用 AI 的次數
  let successfulAnalysesCount = 0; // AI 調用成功且結果有效的次數
  let failedProcessingCount = 0; // 處理失敗的次數 (包含抓取失敗、AI失敗、DB更新失敗等)
  let contentsCheckedCount = 0; // 從 DB 取出來檢查的 URL 數量

  const supabase = getSupabaseClient();
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error(`[${JOB_NAME}] Missing GEMINI_API_KEY!`);
    return new Response(
      JSON.stringify({ success: false, message: "Missing GEMINI_API_KEY" }),
      { status: 500 }
    );
  }
  console.log(`[${JOB_NAME}] Function started.`);

  try {
    // 1. 從 analyzed_contents 表獲取待處理或失敗的記錄
    console.log(
      `[${JOB_NAME}] Fetching up to ${DB_FETCH_LIMIT} pending/failed contents...`
    );
    const { data: contentsToProcess, error: fetchError } = await supabase
      .from("analyzed_contents")
      .select("id, parsed_content_url") // 只需要 id 和 url 來啟動處理
      .in("analysis_status", ["pending", "failed"])
      .order("created_at", { ascending: true }) // 優先處理最早入隊的
      .limit(DB_FETCH_LIMIT);

    if (fetchError) {
      console.error(
        `[${JOB_NAME}] DB Fetch Error (analyzed_contents): ${fetchError.message}`
      );
      throw new Error(`DB Fetch Error: ${fetchError.message}`);
    }

    if (!contentsToProcess || contentsToProcess.length === 0) {
      console.log(`[${JOB_NAME}] No contents found to process.`);
      const duration = (Date.now() - startTime) / 1000;
      return new Response(
        JSON.stringify({
          success: true,
          message: `No contents to process. Duration: ${duration.toFixed(2)}s.`,
        }),
        { status: 200 }
      );
    }
    console.log(
      `[${JOB_NAME}] Found ${contentsToProcess.length} contents to potentially process.`
    );

    // 2. 依次處理每個待處理的內容記錄
    for (const contentRecord of contentsToProcess) {
      contentsCheckedCount++;

      // 在處理前檢查是否已達到本次運行的 AI 分析次數上限
      if (geminiAnalysesAttempted >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
        console.log(
          `[${JOB_NAME}] Analysis limit reached (${GEMINI_ANALYSIS_LIMIT_PER_RUN}). Stopping loop for this run.`
        );
        break; // 提前跳出 for 迴圈
      }

      // 調用輔助函數處理單個記錄
      const result = await processSingleAnalyzedContent(
        contentRecord,
        supabase,
        geminiApiKey
      );

      // 更新統計計數器
      if (result.analysisPerformed) {
        // 如果實際調用了 AI
        geminiAnalysesAttempted++; // 增加 AI 調用計數
        if (result.success) {
          successfulAnalysesCount++; // AI 調用成功
        } else {
          failedProcessingCount++; // AI 調用失敗
        }
      } else {
        // 如果沒有調用 AI (例如因為 category code 被跳過)
        if (!result.success) {
          // 但最終處理結果是失敗 (例如跳過後更新 DB 失敗)
          failedProcessingCount++;
          console.warn(
            `[${JOB_NAME}] Processing failed without AI analysis for ${contentRecord.id}. Error: ${result.errorMessageForLog}`
          );
        }
        // 如果 success 為 true (例如成功跳過)，則不計入成功或失敗的 AI 分析計數
      }

      // 在處理下一個記錄前稍微延遲
      if (contentsCheckedCount < contentsToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS / 2)); // 短暫延遲
      }
    } // End content processing loop
  } catch (error) {
    // 捕捉主流程中的嚴重錯誤
    console.error(`[${JOB_NAME}] CRITICAL Handler Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        stack: error.stack,
      }),
      { status: 500 }
    );
  }

  // 3. 記錄運行總結並返回成功響應
  const duration = (Date.now() - startTime) / 1000;
  const summary =
    `Checked ${contentsCheckedCount} content URLs. ` +
    `Attempted ${geminiAnalysesAttempted} new analyses ` +
    `(${successfulAnalysesCount} success, ${failedProcessingCount} fail). ` + // 失敗計數現在更準確
    `Duration: ${duration.toFixed(2)}s.`;
  console.log(`[${JOB_NAME}] Run finished. ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
  });
});
