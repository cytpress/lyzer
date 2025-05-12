// supabase/functions/analyze-pending-contents/contentProcessor.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchWithRetry } from "../_shared/utils.ts";
import type {
  AnalysisResultJson,
  AnalyzedContentRecord,
  GeminiErrorDetail, // 確保導入
} from "../_shared/utils.ts";
import {
  getAnalysisPrompt,
  getShortenedAnalysisPrompt,
  shouldSkipAnalysis,
} from "./prompts.ts";
import { analyzeWithGemini } from "./geminiAnalyzer.ts";
import {
  JOB_NAME,
  MAX_CONTENT_LENGTH_CHARS,
  CONTENT_FETCH_TIMEOUT_MS,
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
  // baseGenerationConfig, // 不從這裡導入，由 index.ts 傳入
  // safetySettings,       // 不從這裡導入，由 index.ts 傳入
} from "./index.ts";
// 導入 Gemini 的配置類型
import type {
  GenerationConfig,
  SafetySetting,
} from "npm:@google/generative-ai";

export async function processSingleAnalyzedContent(
  contentRecord: AnalyzedContentRecord,
  supabase: SupabaseClient,
  geminiApiKey: string,
  isShortenedAttempt: boolean = false,
  // 接收從 index.ts 傳入的基礎配置
  generationConfig: Omit<
    GenerationConfig,
    | "responseMimeType"
    | "responseSchema"
    | "candidateCount"
    | "stopSequences"
    | "topP"
    | "topK"
  >,
  safetySettings: SafetySetting[]
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  skippedByCategory: boolean;
  needsShortenedRetry?: boolean;
  errorMessageForLog?: string;
  finalStatusSet: AnalyzedContentRecord["analysis_status"];
  resultObjectStored?: AnalysisResultJson | GeminiErrorDetail; // 用於記錄存儲的物件
}> {
  const {
    id: analyzedContentId,
    parsed_content_url,
    analysis_attempts = 0,
    shortened_analysis_attempts = 0,
    error_message: previous_error_message, // 上一次的錯誤訊息
    last_error_type: previous_last_error_type, // 上一次的錯誤類型
  } = contentRecord;
  const uniqueRunId = Math.random().toString(36).substring(2, 8); // 為本次處理生成唯一ID
  const attemptType = isShortenedAttempt ? "shortened" : "regular"; // 判斷是常規還是精簡嘗試
  const currentAttemptNumber =
    (isShortenedAttempt ? shortened_analysis_attempts : analysis_attempts) + 1;
  const maxAttemptsForThisType = isShortenedAttempt
    ? MAX_SHORTENED_ATTEMPTS
    : MAX_REGULAR_ATTEMPTS;

  console.log(
    `[${JOB_NAME}] 開始處理內容 ID: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType}, 嘗試: ${currentAttemptNumber}/${maxAttemptsForThisType}), URL: ${parsed_content_url}`
  );

  let analysisResultObject: AnalysisResultJson | GeminiErrorDetail | undefined;
  let finalStatusToUpdate: AnalyzedContentRecord["analysis_status"] = "failed"; // 默認為失敗
  let finalCommitteeName: string | null = null;
  let analysisPerformed = false;
  let skippedByCategory = false;
  let needsShortenedRetryFlag = false;
  let errorMessageForDb: string | null = null;
  let lastErrorTypeForDb: string | null = null;

  try {
    // 獲取議程的類別代碼，用於判斷是否跳過或調整 Prompt
    const { data: representativeAgenda, error: categoryLookupError } =
      await supabase
        .from("gazette_agendas")
        .select("category_code")
        .eq("parsed_content_url", parsed_content_url) // 假設 parsed_content_url 是唯一的關聯鍵
        .limit(1)
        .maybeSingle(); // 可能沒有對應的議程記錄

    if (categoryLookupError) {
      console.warn(
        `[${JOB_NAME}] 資料庫錯誤 (查詢 category_code 時): ${analyzedContentId} (運行ID: ${uniqueRunId}): ${categoryLookupError.message}。將繼續處理。`
      );
    }
    const categoryCodeForPrompt = representativeAgenda?.category_code ?? null;
    console.log(
      `[${JOB_NAME}] 內容 ID ${analyzedContentId} (運行ID: ${uniqueRunId}) 使用的 category_code: ${categoryCodeForPrompt}。`
    );

    // 根據類別代碼判斷是否應該跳過分析
    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME}] 跳過內容 ID ${analyzedContentId} (類別: ${categoryCodeForPrompt}, 運行ID: ${uniqueRunId})。`
      );
      skippedByCategory = true;
      analysisResultObject = {
        error: "此類別無需摘要 (例如 索引、未知類別)",
        type: "SKIPPED_BY_CATEGORY",
      };
      finalStatusToUpdate = "skipped"; // 更新狀態為跳過
      errorMessageForDb = "因類別跳過分析。";
      lastErrorTypeForDb = "SKIPPED_BY_CATEGORY";
    } else {
      // 將記錄狀態更新為正在處理中
      const currentProcessingStatus = isShortenedAttempt
        ? "processing_shortened"
        : "processing";
      if (contentRecord.analysis_status !== currentProcessingStatus) {
        await supabase
          .from("analyzed_contents")
          .update({
            analysis_status: currentProcessingStatus,
            processing_started_at: new Date().toISOString(),
            analysis_result: null, // 清除舊結果
            error_message: null, // 清除舊錯誤
            last_error_type: null, // 清除舊錯誤類型
          })
          .eq("id", analyzedContentId);
        console.log(
          `[${JOB_NAME}] 已將內容 ID ${analyzedContentId} 標記為 '${currentProcessingStatus}' (運行ID: ${uniqueRunId})。`
        );
      }

      // 抓取遠端文本內容
      let contentText = "";
      let truncated = false; // 標記內容是否因過長而被截斷
      try {
        console.log(
          `[${JOB_NAME}] 正在抓取內容: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${parsed_content_url}`
        );
        const controller = new AbortController(); // 用於超時控制
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
        clearTimeout(timeoutId); // 清除超時
        contentText = await contentResponse.text();
        if (contentText.length > MAX_CONTENT_LENGTH_CHARS) {
          console.warn(
            `[${JOB_NAME}] 內容過長，進行截斷: ${analyzedContentId} (運行ID: ${uniqueRunId}) (長度 ${contentText.length} > 上限 ${MAX_CONTENT_LENGTH_CHARS})。`
          );
          contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
          truncated = true;
        }
        if (!contentText || contentText.trim().length === 0)
          throw new Error("抓取的內容為空或僅包含空白字符");
        console.log(
          `[${JOB_NAME}] 已抓取內容: ${analyzedContentId} (運行ID: ${uniqueRunId}) (大小 ${(
            contentText.length / 1024
          ).toFixed(1)} KB)${truncated ? " [已截斷]" : ""}.`
        );
      } catch (fetchError) {
        errorMessageForDb = `內容抓取錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${fetchError.message}`;
        lastErrorTypeForDb = "FETCH_ERROR";
        console.error(`[${JOB_NAME}] ${errorMessageForDb}`);
        throw fetchError; // 拋出錯誤，由外層 catch 處理
      }

      // 準備並調用 Gemini AI 進行分析
      console.log(
        `[${JOB_NAME}] 正在使用 Gemini 分析內容: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType}, 類別: ${categoryCodeForPrompt})...`
      );
      const promptInputError =
        previous_error_message ||
        `前次錯誤類型: ${previous_last_error_type || "N/A"}`;
      const prompt = isShortenedAttempt
        ? getShortenedAnalysisPrompt(
            categoryCodeForPrompt,
            contentText,
            truncated,
            promptInputError
          )
        : getAnalysisPrompt(categoryCodeForPrompt, contentText, truncated);

      analysisResultObject = await analyzeWithGemini(
        prompt,
        geminiApiKey,
        contentText,
        generationConfig,
        safetySettings
      );
      analysisPerformed = true;

      // 根據 AI 分析結果更新狀態
      if (analysisResultObject && !("error" in analysisResultObject)) {
        // AI 分析成功且返回了預期的 JSON 結構 (已在 analyzeWithGemini 中後處理過)
        finalStatusToUpdate = isShortenedAttempt
          ? "partially_completed"
          : "completed";
        finalCommitteeName =
          typeof analysisResultObject.committee_name === "string"
            ? analysisResultObject.committee_name
            : null;
        console.log(
          `[${JOB_NAME}] 分析成功: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType})。委員會: ${
            finalCommitteeName ?? "N/A"
          }。`
        );
      } else {
        // AI 分析失敗或返回了錯誤對象
        const geminiError = analysisResultObject as GeminiErrorDetail; // 類型斷言，可能為 undefined
        errorMessageForDb = geminiError?.error || "未知的 Gemini 分析錯誤";
        lastErrorTypeForDb = geminiError?.type || "UNKNOWN_GEMINI_ERROR";
        console.warn(
          `[${JOB_NAME}] Gemini 分析失敗: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType})。錯誤: ${errorMessageForDb}, 類型: ${lastErrorTypeForDb}`
        );

        // 判斷是否需要轉為精簡 Prompt 重試
        if (
          !isShortenedAttempt && // 僅常規嘗試才考慮轉精簡
          (lastErrorTypeForDb === "MAX_TOKENS" ||
            lastErrorTypeForDb === "JSON_PARSE_ERROR_WITH_SCHEMA" || // 使用 schema 後，解析錯誤應減少
            lastErrorTypeForDb === "SCHEMA_ERROR_OR_OTHER") // schema 本身或與內容不匹配導致的錯誤
          // 可以考慮是否將 "CONTENT_ELLIPSIS_IN_VALID_SCHEMA" 也加入精簡重試的條件
        ) {
          if (
            currentAttemptNumber < MAX_REGULAR_ATTEMPTS &&
            (shortened_analysis_attempts || 0) < MAX_SHORTENED_ATTEMPTS
          ) {
            console.log(
              `[${JOB_NAME}] 內容 ID ${analyzedContentId} (運行ID: ${uniqueRunId}) 因 ${lastErrorTypeForDb} 標記為需要精簡重試。`
            );
            needsShortenedRetryFlag = true;
            finalStatusToUpdate = "needs_shortened_retry";
          } else {
            console.error(
              `[${JOB_NAME}] 內容 ID ${analyzedContentId} (運行ID: ${uniqueRunId}) 在遇到 ${lastErrorTypeForDb} 後，已達常規嘗試上限或無剩餘精簡嘗試次數。標記為失敗。`
            );
            finalStatusToUpdate = "failed";
          }
        } else {
          // 其他錯誤，或已是精簡嘗試失敗，或非上述特定錯誤
          if (currentAttemptNumber >= maxAttemptsForThisType) {
            console.error(
              `[${JOB_NAME}] 內容 ID ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType}) 已達最大嘗試次數 (${maxAttemptsForThisType})。標記為失敗。`
            );
            finalStatusToUpdate = "failed";
          } else {
            // 如果未達最大次數，則設為 'pending'，以便下次被主循環的 'pending' 或 'failed' 查詢選中
            // （主循環會查詢 'pending' 或 'failed' 狀態的記錄進行常規分析）
            console.warn(
              `[${JOB_NAME}] 分析失敗: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptType}, 嘗試: ${currentAttemptNumber}/${maxAttemptsForThisType})，將根據剩餘嘗試次數重新排隊為 'pending' 或標記為 'failed'。錯誤: ${errorMessageForDb}`
            );
            finalStatusToUpdate =
              currentAttemptNumber < maxAttemptsForThisType
                ? "pending"
                : "failed";
          }
        }
      }
    }
  } catch (error) {
    // 處理流程中（如內容抓取）拋出的其他錯誤
    console.error(
      `[${JOB_NAME}] 處理流程錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${error.message}`
    );
    finalStatusToUpdate = "failed"; // 歸為失敗
    errorMessageForDb = errorMessageForDb || error.message; // 如果之前沒有錯誤信息，則使用當前錯誤信息
    lastErrorTypeForDb = lastErrorTypeForDb || "PIPELINE_ERROR"; // 標記為流程錯誤
    // 確保 analysisResultObject 在錯誤情況下也是一個錯誤對象
    if (!analysisResultObject || !("error" in analysisResultObject)) {
      analysisResultObject = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb as GeminiErrorDetail["type"],
      };
    }
  } finally {
    // 準備最終要更新到數據庫的 payload
    let resultToStoreOnDb: AnalysisResultJson | GeminiErrorDetail | null = null;

    if (
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed"
    ) {
      if (analysisResultObject && !("error" in analysisResultObject)) {
        // 成功的分析結果 (已經過後處理)
        resultToStoreOnDb = analysisResultObject;
      } else {
        // 理論上不應該發生：狀態是成功但結果卻是錯誤對象或未定義
        console.warn(
          `[${JOB_NAME}] 狀態為 ${finalStatusToUpdate} 但 analysisResultObject 是錯誤對象或未定義。將為 analysis_result 儲存 null 或錯誤信息。`
        );
        resultToStoreOnDb =
          analysisResultObject && "error" in analysisResultObject
            ? analysisResultObject // 如果是錯誤對象，存儲它
            : {
                error: "分析標記為成功但結果對象是錯誤或缺失",
                type: "INCONSISTENT_STATE",
              }; // 創建一個新的錯誤對象
      }
    } else if (analysisResultObject && "error" in analysisResultObject) {
      // 對於失敗的情況 (例如 Gemini 返回錯誤)，存儲 GeminiErrorDetail
      resultToStoreOnDb = analysisResultObject;
    } else if (errorMessageForDb) {
      // 如果 analysisResultObject 未定義，但有其他流程錯誤信息
      resultToStoreOnDb = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb || "UNKNOWN_ERROR_FINAL",
      };
    }
    // 如果以上條件都不滿足 (例如 status 是 skipped 且沒有 analysisResultObject)，resultToStoreOnDb 將保持為 null

    const updatePayload: Partial<AnalyzedContentRecord> = {
      analysis_status: finalStatusToUpdate,
      analysis_result: resultToStoreOnDb, // 存儲處理後的結果或錯誤對象
      analyzed_at:
        finalStatusToUpdate === "completed" ||
        finalStatusToUpdate === "partially_completed"
          ? new Date().toISOString()
          : null,
      committee_name:
        (finalStatusToUpdate === "completed" ||
          finalStatusToUpdate === "partially_completed") &&
        analysisResultObject &&
        !("error" in analysisResultObject)
          ? (analysisResultObject as AnalysisResultJson).committee_name
          : null, // 僅在成功時更新委員會名稱
      error_message: errorMessageForDb, // 存儲本次處理的錯誤信息
      last_error_type: lastErrorTypeForDb, // 存儲本次處理的錯誤類型
      analysis_attempts: !isShortenedAttempt
        ? currentAttemptNumber
        : analysis_attempts || 0, // 更新常規嘗試次數
      shortened_analysis_attempts: isShortenedAttempt
        ? currentAttemptNumber
        : shortened_analysis_attempts || 0, // 更新精簡嘗試次數
      processing_started_at: null, // 在處理完成或失敗後清除此標記
    };

    // 如果最終狀態是 'pending' (表示將在下次被 'pending'/'failed' 查詢選中重試)
    // 我們可能希望保留導致這次重試的錯誤信息，而不是完全清除
    if (finalStatusToUpdate === "pending") {
      // 保留 contentRecord 中已有的錯誤信息（如果是第一次失敗），或者使用本次的錯誤信息
      updatePayload.error_message =
        contentRecord.error_message || errorMessageForDb;
      updatePayload.last_error_type =
        contentRecord.last_error_type || lastErrorTypeForDb;
      // 保留 contentRecord 中已有的 analysis_result (如果是錯誤對象)，或者使用本次的 resultToStoreOnDb (如果是新的錯誤對象)
      updatePayload.analysis_result =
        contentRecord.analysis_result || resultToStoreOnDb;
    }

    console.log(
      `[${JOB_NAME}] 準備資料庫更新: ${analyzedContentId} (運行ID: ${uniqueRunId}), 最終狀態: ${finalStatusToUpdate}`
    );
    try {
      const { error: updateError } = await supabase
        .from("analyzed_contents")
        .update(updatePayload)
        .eq("id", analyzedContentId);
      if (updateError) {
        console.error(
          `[${JOB_NAME}] !!! 資料庫更新錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${updateError.message}`
        );
      } else {
        console.log(
          `[${JOB_NAME}] 資料庫已成功更新: ${analyzedContentId} (運行ID: ${uniqueRunId})，狀態為 ${finalStatusToUpdate}。`
        );
      }
    } catch (updateEx) {
      console.error(
        `[${JOB_NAME}] !!! 資料庫更新異常: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${updateEx.message}`
      );
    }
    console.log(
      `[${JOB_NAME}] 結束處理內容 ID: ${analyzedContentId} (運行ID: ${uniqueRunId})`
    );
  }

  return {
    success:
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed" ||
      finalStatusToUpdate === "skipped",
    analysisPerformed,
    skippedByCategory,
    needsShortenedRetry: needsShortenedRetryFlag,
    errorMessageForLog:
      finalStatusToUpdate === "failed" ||
      finalStatusToUpdate === "needs_shortened_retry"
        ? errorMessageForDb || undefined
        : undefined,
    finalStatusSet: finalStatusToUpdate,
    resultObjectStored: analysisResultObject, // 返回原始的 AI 結果或錯誤對象，供上層日誌記錄
  };
}
