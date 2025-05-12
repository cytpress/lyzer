import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  fetchWithRetry,
  AnalysisResultJson,
  AnalyzedContentRecord,
  GeminiErrorDetail,
  MAX_REGULAR_ATTEMPTS, // 從 _shared 導入
  MAX_SHORTENED_ATTEMPTS, // 從 _shared 導入
  JOB_NAME_ANALYZER, // 從 _shared 導入 (用於日誌)
} from "../_shared/utils.ts";
import {
  getAnalysisPrompt,
  getShortenedAnalysisPrompt,
  shouldSkipAnalysis,
} from "./prompts.ts";
import { analyzeWithGemini } from "./geminiAnalyzer.ts";
import {
  // JOB_NAME, // 不再從這裡導入，使用 JOB_NAME_ANALYZER
  MAX_CONTENT_LENGTH_CHARS,
  CONTENT_FETCH_TIMEOUT_MS,
  // MAX_REGULAR_ATTEMPTS, // 已移至 _shared
  // MAX_SHORTENED_ATTEMPTS, // 已移至 _shared
  baseGenerationConfig, // 從當前目錄的 index.ts 導入
  safetySettings, // 從當前目錄的 index.ts 導入
} from "./index.ts"; // 從同目錄的 index.ts 導入配置
import type { SafetySetting } from "npm:@google/genai";

export async function processSingleAnalyzedContent(
  contentRecord: AnalyzedContentRecord,
  supabase: SupabaseClient,
  geminiApiKey: string,
  isShortenedAttempt: boolean = false,
  generationConfigParams: typeof baseGenerationConfig, // 類型應與 index.ts 中定義的保持一致
  safetySettingsParams: SafetySetting[] // 類型應與 index.ts 中定義的保持一致
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  skippedByCategory: boolean;
  // needsShortenedRetry 標誌不再需要，因為狀態直接由 DB 驅動
  errorMessageForLog?: string;
  finalStatusSet: AnalyzedContentRecord["analysis_status"];
  resultObjectStored?: AnalysisResultJson | GeminiErrorDetail;
}> {
  const {
    id: analyzedContentId,
    parsed_content_url,
    analysis_attempts = 0,
    shortened_analysis_attempts = 0,
    error_message: previous_error_message,
    last_error_type: previous_last_error_type,
  } = contentRecord;

  const uniqueRunId = Math.random().toString(36).substring(2, 8);

  const actualAttemptTypeIsShortened = isShortenedAttempt;
  let currentAttemptNumberForThisType: number;

  if (isShortenedAttempt) {
    currentAttemptNumberForThisType = shortened_analysis_attempts + 1;
  } else {
    currentAttemptNumberForThisType = analysis_attempts + 1;
  }
  const attemptTypeDisplay = actualAttemptTypeIsShortened
    ? "shortened"
    : "regular";
  const maxAttemptsForThisType = actualAttemptTypeIsShortened
    ? MAX_SHORTENED_ATTEMPTS
    : MAX_REGULAR_ATTEMPTS;

  console.log(
    `[${JOB_NAME_ANALYZER}] 開始處理內容 ID: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptTypeDisplay}, 嘗試: ${currentAttemptNumberForThisType}/${maxAttemptsForThisType}), URL: ${parsed_content_url}`
  );

  let analysisResultObject: AnalysisResultJson | GeminiErrorDetail | undefined;
  let finalStatusToUpdate: AnalyzedContentRecord["analysis_status"] = "failed"; // 預設失敗
  let finalCommitteeName: string | null = null;
  let analysisPerformed = false;
  let skippedByCategory = false;

  let errorMessageForDb: string | null = null;
  let lastErrorTypeForDb: string | null = null;

  let nextAnalysisAttempts = analysis_attempts;
  let nextShortenedAnalysisAttempts = shortened_analysis_attempts;

  try {
    const { data: representativeAgenda, error: categoryLookupError } =
      await supabase
        .from("gazette_agendas")
        .select("category_code")
        .eq("parsed_content_url", parsed_content_url)
        .limit(1)
        .maybeSingle();

    if (categoryLookupError) {
      console.warn(
        `[${JOB_NAME_ANALYZER}] 資料庫錯誤 (查詢 category_code 時): ${analyzedContentId} (運行ID: ${uniqueRunId}): ${categoryLookupError.message}。將繼續處理。`
      );
    }
    const categoryCodeForPrompt = representativeAgenda?.category_code ?? null;
    console.log(
      `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} (運行ID: ${uniqueRunId}) 使用的 category_code: ${categoryCodeForPrompt}。`
    );

    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME_ANALYZER}] 跳過內容 ID ${analyzedContentId} (類別: ${categoryCodeForPrompt}, 運行ID: ${uniqueRunId})。`
      );
      skippedByCategory = true;
      analysisResultObject = {
        error: "此類別無需摘要 (例如 索引、未知類別)",
        type: "SKIPPED_BY_CATEGORY",
      };
      finalStatusToUpdate = "skipped";
      errorMessageForDb = "因類別跳過分析。";
      lastErrorTypeForDb = "SKIPPED_BY_CATEGORY";
    } else {
      const currentProcessingStatus = actualAttemptTypeIsShortened
        ? "processing_shortened"
        : "processing";
      if (contentRecord.analysis_status !== currentProcessingStatus) {
        await supabase
          .from("analyzed_contents")
          .update({
            analysis_status: currentProcessingStatus,
            processing_started_at: new Date().toISOString(),
            analysis_result: null, // 清空舊結果
            error_message: null, // 清空舊錯誤
            last_error_type: null, // 清空舊錯誤類型
          })
          .eq("id", analyzedContentId);
        console.log(
          `[${JOB_NAME_ANALYZER}] 已將內容 ID ${analyzedContentId} 標記為 '${currentProcessingStatus}' (運行ID: ${uniqueRunId})。`
        );
      }

      let contentText = "";
      let truncated = false;
      try {
        console.log(
          `[${JOB_NAME_ANALYZER}] 正在抓取內容: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${parsed_content_url}`
        );
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          CONTENT_FETCH_TIMEOUT_MS
        );
        const contentResponse = await fetchWithRetry(
          parsed_content_url,
          { signal: controller.signal },
          2, // 這裡可以考慮使用共享常量
          `${JOB_NAME_ANALYZER}-contentFetch`
        );
        clearTimeout(timeoutId);
        contentText = await contentResponse.text();
        if (contentText.length > MAX_CONTENT_LENGTH_CHARS) {
          console.warn(
            `[${JOB_NAME_ANALYZER}] 內容過長，進行截斷: ${analyzedContentId} (運行ID: ${uniqueRunId}) (長度 ${contentText.length} > 上限 ${MAX_CONTENT_LENGTH_CHARS})。`
          );
          contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
          truncated = true;
        }
        if (!contentText || contentText.trim().length === 0)
          throw new Error("抓取的內容為空或僅包含空白字符");
        console.log(
          `[${JOB_NAME_ANALYZER}] 已抓取內容: ${analyzedContentId} (運行ID: ${uniqueRunId}) (大小 ${(
            contentText.length / 1024
          ).toFixed(1)} KB)${truncated ? " [已截斷]" : ""}.`
        );
      } catch (fetchError) {
        errorMessageForDb = `內容抓取錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${fetchError.message}`;
        lastErrorTypeForDb = "FETCH_ERROR";
        console.error(`[${JOB_NAME_ANALYZER}] ${errorMessageForDb}`);
        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }
        throw fetchError; // 拋給外層 catch 以觸發 finally 中的狀態更新
      }

      console.log(
        `[${JOB_NAME_ANALYZER}] 正在使用 Gemini 分析內容: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptTypeDisplay}, 類別: ${categoryCodeForPrompt})...`
      );
      const promptInputError =
        previous_error_message ||
        `前次錯誤類型: ${previous_last_error_type || "N/A"}`;

      const prompt = actualAttemptTypeIsShortened
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
        contentText, // for logging only
        generationConfigParams,
        safetySettingsParams
      );
      analysisPerformed = true;

      if (analysisResultObject && !("error" in analysisResultObject)) {
        finalStatusToUpdate = actualAttemptTypeIsShortened
          ? "partially_completed"
          : "completed";
        finalCommitteeName =
          typeof analysisResultObject.committee_name === "string"
            ? analysisResultObject.committee_name
            : null;
        console.log(
          `[${JOB_NAME_ANALYZER}] 分析成功: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptTypeDisplay})。委員會: ${
            finalCommitteeName ?? "N/A"
          }。`
        );
        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }
      } else {
        const geminiError = analysisResultObject as GeminiErrorDetail;
        errorMessageForDb = geminiError?.error || "未知的 Gemini 分析錯誤";
        lastErrorTypeForDb = geminiError?.type || "UNKNOWN_GEMINI_ERROR";
        console.warn(
          `[${JOB_NAME_ANALYZER}] Gemini 分析失敗: ${analyzedContentId} (運行ID: ${uniqueRunId}, 類型: ${attemptTypeDisplay})。錯誤: ${errorMessageForDb}, 類型: ${lastErrorTypeForDb}`
        );

        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }

        // 決定下一次的狀態
        if (!actualAttemptTypeIsShortened) {
          // 本次是常規分析失敗
          if (nextAnalysisAttempts < MAX_REGULAR_ATTEMPTS) {
            finalStatusToUpdate = "pending";
            console.log(
              `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} 常規分析失敗 (嘗試 ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS})，將重新排隊進行常規分析。`
            );
          } else {
            // 常規分析已達上限
            if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
              finalStatusToUpdate = "needs_shortened_retry";
              console.log(
                `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} 常規分析已達上限，將標記為需要精簡重試。`
              );
            } else {
              // 常規和精簡都已達上限
              finalStatusToUpdate = "failed";
              console.error(
                `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} 常規及精簡分析均已達到最大嘗試次數。標記為最終失敗。`
              );
            }
          }
        } else {
          // 本次是精簡分析失敗
          if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
            finalStatusToUpdate = "needs_shortened_retry"; // 繼續精簡重試
            console.log(
              `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} 精簡分析失敗 (嘗試 ${nextShortenedAnalysisAttempts}/${MAX_SHORTENED_ATTEMPTS})，將重新排隊進行精簡分析。`
            );
          } else {
            // 精簡分析也已達上限
            finalStatusToUpdate = "failed";
            console.error(
              `[${JOB_NAME_ANALYZER}] 內容 ID ${analyzedContentId} 精簡分析已達到最大嘗試次數。標記為最終失敗。`
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME_ANALYZER}] 處理流程錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${error.message}`
    );
    // finalStatusToUpdate 默認為 'failed'，這裡不再重複設置，除非有特定邏輯
    errorMessageForDb = errorMessageForDb || `流程錯誤: ${error.message}`; // 如果已有 fetchError 的 message，不覆蓋
    lastErrorTypeForDb = lastErrorTypeForDb || "PIPELINE_ERROR";

    // 確保嘗試次數被正確更新
    if (actualAttemptTypeIsShortened) {
      if (shortened_analysis_attempts < currentAttemptNumberForThisType) {
        // 確保只增加一次
        nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
      }
    } else {
      if (analysis_attempts < currentAttemptNumberForThisType) {
        // 確保只增加一次
        nextAnalysisAttempts = currentAttemptNumberForThisType;
      }
    }

    // 根據更新後的嘗試次數重新判斷最終狀態 (主要針對抓取失敗等情況)
    if (!actualAttemptTypeIsShortened) {
      // 如果是常規流程中斷
      if (nextAnalysisAttempts < MAX_REGULAR_ATTEMPTS) {
        finalStatusToUpdate = "pending";
      } else if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
        finalStatusToUpdate = "needs_shortened_retry";
      } else {
        finalStatusToUpdate = "failed";
      }
    } else {
      // 如果是精簡流程中斷
      if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
        finalStatusToUpdate = "needs_shortened_retry";
      } else {
        finalStatusToUpdate = "failed";
      }
    }

    if (!analysisResultObject || !("error" in analysisResultObject)) {
      analysisResultObject = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb as GeminiErrorDetail["type"],
      };
    }
  } finally {
    let resultToStoreOnDb: AnalysisResultJson | GeminiErrorDetail | null = null;

    if (
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed"
    ) {
      if (analysisResultObject && !("error" in analysisResultObject)) {
        resultToStoreOnDb = analysisResultObject;
      } else {
        console.warn(
          `[${JOB_NAME_ANALYZER}] 狀態為 ${finalStatusToUpdate} 但 analysisResultObject 是錯誤對象或未定義。將為 analysis_result 儲存錯誤信息。 ID: ${analyzedContentId}`
        );
        const errorMsg =
          analysisResultObject && "error" in analysisResultObject
            ? analysisResultObject.error
            : "分析標記為成功但結果對象是錯誤或缺失";
        const errorType =
          analysisResultObject && "error" in analysisResultObject
            ? analysisResultObject.type
            : "INCONSISTENT_STATE";
        resultToStoreOnDb = { error: errorMsg, type: errorType };
        // 如果是成功狀態但結果有問題，應將狀態改為 failed
        finalStatusToUpdate = "failed";
        errorMessageForDb = errorMsg;
        lastErrorTypeForDb = errorType;
      }
    } else if (analysisResultObject && "error" in analysisResultObject) {
      resultToStoreOnDb = analysisResultObject;
    } else if (errorMessageForDb) {
      // 適用於跳過分析或流程錯誤
      resultToStoreOnDb = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb || "UNKNOWN_ERROR_FINAL",
      };
    }

    const updatePayload: Partial<AnalyzedContentRecord> = {
      analysis_status: finalStatusToUpdate,
      analysis_result: resultToStoreOnDb,
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
          : null, // 失敗或跳過時不應設置委員會
      error_message: errorMessageForDb,
      last_error_type: lastErrorTypeForDb,
      analysis_attempts: nextAnalysisAttempts,
      shortened_analysis_attempts: nextShortenedAnalysisAttempts,
      processing_started_at: null, // 清除 processing_started_at
    };

    // 如果是重試狀態 (pending 或 needs_shortened_retry)，保留上一次的錯誤信息和結果以供參考
    // 只有在本次沒有新的錯誤信息時，才保留舊的
    if (
      finalStatusToUpdate === "pending" ||
      finalStatusToUpdate === "needs_shortened_retry"
    ) {
      updatePayload.error_message =
        errorMessageForDb || contentRecord.error_message;
      updatePayload.last_error_type =
        lastErrorTypeForDb || contentRecord.last_error_type;
      updatePayload.analysis_result =
        resultToStoreOnDb || contentRecord.analysis_result; // 保留本次錯誤或上次的錯誤結果
    } else if (finalStatusToUpdate === "skipped") {
      // 如果是 skipped, 確保 error_message 和 last_error_type 是 skipped 相關的
      updatePayload.error_message = "因類別跳過分析。";
      updatePayload.last_error_type = "SKIPPED_BY_CATEGORY";
      updatePayload.analysis_result = {
        error: "此類別無需摘要 (例如 索引、未知類別)",
        type: "SKIPPED_BY_CATEGORY",
      };
    }

    console.log(
      `[${JOB_NAME_ANALYZER}] 準備資料庫更新: ${analyzedContentId} (運行ID: ${uniqueRunId}), 最終狀態: ${finalStatusToUpdate}, 常規嘗試: ${updatePayload.analysis_attempts}, 精簡嘗試: ${updatePayload.shortened_analysis_attempts}`
    );
    try {
      const { error: updateError } = await supabase
        .from("analyzed_contents")
        .update(updatePayload)
        .eq("id", analyzedContentId);
      if (updateError) {
        console.error(
          `[${JOB_NAME_ANALYZER}] !!! 資料庫更新錯誤: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${updateError.message}`
        );
      } else {
        console.log(
          `[${JOB_NAME_ANALYZER}] 資料庫已成功更新: ${analyzedContentId} (運行ID: ${uniqueRunId})，狀態為 ${finalStatusToUpdate}。`
        );
      }
    } catch (updateEx) {
      console.error(
        `[${JOB_NAME_ANALYZER}] !!! 資料庫更新異常: ${analyzedContentId} (運行ID: ${uniqueRunId}): ${updateEx.message}`
      );
    }
    console.log(
      `[${JOB_NAME_ANALYZER}] 結束處理內容 ID: ${analyzedContentId} (運行ID: ${uniqueRunId})`
    );
  }

  return {
    success:
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed" ||
      finalStatusToUpdate === "skipped",
    analysisPerformed,
    skippedByCategory,
    errorMessageForLog:
      finalStatusToUpdate === "failed" ||
      finalStatusToUpdate === "needs_shortened_retry" ||
      finalStatusToUpdate === "pending"
        ? errorMessageForDb || undefined
        : undefined,
    finalStatusSet: finalStatusToUpdate,
    resultObjectStored: analysisResultObject, // 返回實際的分析結果或錯誤對象
  };
}
