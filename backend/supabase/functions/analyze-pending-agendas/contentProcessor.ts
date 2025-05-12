// supabase/functions/analyze-pending-contents/contentProcessor.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchWithRetry } from "../_shared/utils.ts"; // 從 _shared 導入
import type {
  AnalysisResultJson,
  AnalyzedContentRecord,
  GeminiErrorDetail,
} from "../_shared/utils.ts";
import {
  getAnalysisPrompt,
  getShortenedAnalysisPrompt,
  shouldSkipAnalysis,
} from "./prompts.ts"; // 從同目錄導入
import { analyzeWithGemini } from "./geminiAnalyzer.ts"; // 從同目錄導入
import {
  JOB_NAME,
  MAX_CONTENT_LENGTH_CHARS,
  CONTENT_FETCH_TIMEOUT_MS,
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
} from "./index.ts"; // 從主 index.ts 導入配置

// processSingleAnalyzedContent 函數現在在這個文件中
export async function processSingleAnalyzedContent(
  contentRecord: AnalyzedContentRecord,
  supabase: SupabaseClient,
  geminiApiKey: string,
  isShortenedAttempt: boolean = false
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  skippedByCategory: boolean;
  needsShortenedRetry?: boolean;
  errorMessageForLog?: string;
  finalStatusSet: AnalyzedContentRecord["analysis_status"];
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
  const attemptType = isShortenedAttempt ? "shortened" : "regular";
  const currentAttemptNumber =
    (isShortenedAttempt ? shortened_analysis_attempts : analysis_attempts) + 1;
  const maxAttemptsForThisType = isShortenedAttempt
    ? MAX_SHORTENED_ATTEMPTS
    : MAX_REGULAR_ATTEMPTS;

  console.log(
    `[${JOB_NAME}] START Processing Content ID: ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}, Attempt: ${currentAttemptNumber}/${maxAttemptsForThisType}), URL: ${parsed_content_url}`
  );

  let analysisResultObject: AnalysisResultJson | GeminiErrorDetail | undefined;
  let finalStatusToUpdate: AnalyzedContentRecord["analysis_status"] = "failed";
  let finalCommitteeName: string | null = null;
  let analysisPerformed = false;
  let skippedByCategory = false;
  let needsShortenedRetryFlag = false;
  let errorMessageForDb: string | null = null;
  let lastErrorTypeForDb: string | null = null;

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
        `[${JOB_NAME}] DB error fetching category_code for ${analyzedContentId} (Run: ${uniqueRunId}): ${categoryLookupError.message}. Proceeding without category hint.`
      );
      // 即使 category_code 獲取失敗，也應該繼續嘗試分析，除非是關鍵錯誤
    }
    const categoryCodeForPrompt = representativeAgenda?.category_code ?? null;
    console.log(
      `[${JOB_NAME}] Using category_code ${categoryCodeForPrompt} for ${analyzedContentId} (Run: ${uniqueRunId}).`
    );

    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME}] Skipping Content ID ${analyzedContentId} (Category: ${categoryCodeForPrompt}, Run: ${uniqueRunId}).`
      );
      skippedByCategory = true;
      analysisResultObject = {
        error: "此類別無需摘要 (例如 索引、未知類別)",
        type: "SKIPPED_BY_CATEGORY" as GeminiErrorDetail["type"],
      };
      finalStatusToUpdate = "skipped";
      errorMessageForDb = "Skipped by category."; // 記錄原因
      lastErrorTypeForDb = "SKIPPED_BY_CATEGORY";
    } else {
      const currentProcessingStatus = isShortenedAttempt
        ? "processing_shortened"
        : "processing";
      if (contentRecord.analysis_status !== currentProcessingStatus) {
        await supabase
          .from("analyzed_contents")
          .update({
            analysis_status: currentProcessingStatus,
            processing_started_at: new Date().toISOString(),
            analysis_result: null,
            error_message: null,
            last_error_type: null,
          })
          .eq("id", analyzedContentId);
        console.log(
          `[${JOB_NAME}] Marked Content ID ${analyzedContentId} as '${currentProcessingStatus}' (Run: ${uniqueRunId}).`
        );
      }

      let contentText = "";
      let truncated = false;
      try {
        console.log(
          `[${JOB_NAME}] Fetching content for ${analyzedContentId} (Run: ${uniqueRunId}): ${parsed_content_url}`
        );
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
            `[${JOB_NAME}] Truncating content for ${analyzedContentId} (Run: ${uniqueRunId}) (${contentText.length} > ${MAX_CONTENT_LENGTH_CHARS}).`
          );
          contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
          truncated = true;
        }
        if (!contentText || contentText.trim().length === 0)
          throw new Error("抓取的內容為空或僅包含空白字符");
        console.log(
          `[${JOB_NAME}] Fetched content for ${analyzedContentId} (Run: ${uniqueRunId}) (${(
            contentText.length / 1024
          ).toFixed(1)} KB)${truncated ? " [Truncated]" : ""}.`
        );
      } catch (fetchError) {
        errorMessageForDb = `內容抓取錯誤 for ${analyzedContentId} (Run: ${uniqueRunId}): ${fetchError.message}`;
        lastErrorTypeForDb = "FETCH_ERROR";
        console.error(`[${JOB_NAME}] ${errorMessageForDb}`);
        throw fetchError; // 拋給外層 catch，最終會將 status 設為 failed
      }

      console.log(
        `[${JOB_NAME}] Analyzing content for ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}, Category: ${categoryCodeForPrompt}) with Gemini...`
      );
      const promptInputError =
        previous_error_message ||
        `Previous error type: ${previous_last_error_type || "N/A"}`;
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
        contentText
      );
      analysisPerformed = true;

      if (analysisResultObject && !("error" in analysisResultObject)) {
        finalStatusToUpdate = isShortenedAttempt
          ? "partially_completed"
          : "completed";
        finalCommitteeName =
          typeof analysisResultObject.committee_name === "string"
            ? analysisResultObject.committee_name
            : null;
        console.log(
          `[${JOB_NAME}] Analysis successful for ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}). Committee: ${
            finalCommitteeName ?? "N/A"
          }.`
        );
        // ... (可以保留委員會名稱驗證邏輯)
      } else {
        const geminiError = analysisResultObject as GeminiErrorDetail;
        errorMessageForDb = geminiError?.error || "未知 Gemini 分析錯誤";
        lastErrorTypeForDb = geminiError?.type || "UNKNOWN_GEMINI_ERROR";
        console.warn(
          `[${JOB_NAME}] Gemini Analysis FAILED for ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}). Error: ${errorMessageForDb}, Type: ${lastErrorTypeForDb}`
        );

        if (
          !isShortenedAttempt &&
          (lastErrorTypeForDb === "MAX_TOKENS" ||
            lastErrorTypeForDb === "JSON_PARSE_ERROR" ||
            lastErrorTypeForDb === "CONTENT_ELLIPSIS_TRUNCATION")
        ) {
          if (
            currentAttemptNumber < MAX_REGULAR_ATTEMPTS &&
            (shortened_analysis_attempts || 0) < MAX_SHORTENED_ATTEMPTS
          ) {
            console.log(
              `[${JOB_NAME}] Marking ${analyzedContentId} (Run: ${uniqueRunId}) for shortened retry due to ${lastErrorTypeForDb}. Regular attempts: ${currentAttemptNumber}/${MAX_REGULAR_ATTEMPTS}`
            );
            needsShortenedRetryFlag = true;
            finalStatusToUpdate = "needs_shortened_retry";
          } else {
            console.error(
              `[${JOB_NAME}] Max regular attempts reached or no shortened attempts left for ${analyzedContentId} (Run: ${uniqueRunId}) after encountering ${lastErrorTypeForDb}. Marking as failed.`
            );
            finalStatusToUpdate = "failed";
          }
        } else {
          if (currentAttemptNumber >= maxAttemptsForThisType) {
            console.error(
              `[${JOB_NAME}] Max attempts (${maxAttemptsForThisType}) reached for ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}). Marking as failed.`
            );
            finalStatusToUpdate = "failed";
          } else {
            console.warn(
              `[${JOB_NAME}] Analysis failed for ${analyzedContentId} (Run: ${uniqueRunId}, Type: ${attemptType}, Attempt: ${currentAttemptNumber}/${maxAttemptsForThisType}), will be retried as 'pending' for next ${attemptType} run. Error: ${errorMessageForDb}`
            );
            finalStatusToUpdate = "pending"; // 主循環會根據 status 重新查詢
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Pipeline Error for ${analyzedContentId} (Run: ${uniqueRunId}): ${error.message}`
    );
    finalStatusToUpdate = "failed"; // 歸為失敗
    errorMessageForDb = errorMessageForDb || error.message;
    lastErrorTypeForDb = lastErrorTypeForDb || "PIPELINE_ERROR";
    if (!analysisResultObject || !("error" in analysisResultObject)) {
      analysisResultObject = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb as GeminiErrorDetail["type"],
      };
    }
  } finally {
    const updatePayload: Partial<AnalyzedContentRecord> = {
      analysis_status: finalStatusToUpdate,
      analysis_result: analysisResultObject,
      analyzed_at:
        finalStatusToUpdate === "completed" ||
        finalStatusToUpdate === "partially_completed"
          ? new Date().toISOString()
          : null,
      committee_name: finalCommitteeName,
      error_message: errorMessageForDb,
      last_error_type: lastErrorTypeForDb,
      analysis_attempts: !isShortenedAttempt
        ? currentAttemptNumber
        : analysis_attempts || 0, // 只有常規嘗試才增加 analysis_attempts
      shortened_analysis_attempts: isShortenedAttempt
        ? currentAttemptNumber
        : shortened_analysis_attempts || 0, // 只有精簡嘗試才增加 shortened_analysis_attempts
      processing_started_at: null,
    };

    if (finalStatusToUpdate === "pending") {
      // 如果是要重試 (設回 pending)，不要清除上次的錯誤信息，以便下次重試時參考
      // delete updatePayload.error_message; // 保留 error_message
      // delete updatePayload.last_error_type; // 保留 last_error_type
      // 也不清除 analysis_result，因為它可能包含了上次失敗的原始輸出
    }

    console.log(
      `[${JOB_NAME}] Preparing DB Update for ${analyzedContentId} (Run: ${uniqueRunId}), Final Status: ${finalStatusToUpdate}`
    );
    try {
      const { error: updateError } = await supabase
        .from("analyzed_contents")
        .update(updatePayload)
        .eq("id", analyzedContentId);
      if (updateError) {
        console.error(
          `[${JOB_NAME}] !!! DB Update Error for ${analyzedContentId} (Run: ${uniqueRunId}): ${updateError.message}`
        );
      } else {
        console.log(
          `[${JOB_NAME}] DB updated successfully for ${analyzedContentId} (Run: ${uniqueRunId}) with status ${finalStatusToUpdate}.`
        );
      }
    } catch (updateEx) {
      console.error(
        `[${JOB_NAME}] !!! DB Update Exception for ${analyzedContentId} (Run: ${uniqueRunId}): ${updateEx.message}`
      );
    }
    console.log(
      `[${JOB_NAME}] END Processing Content ID: ${analyzedContentId} (Run: ${uniqueRunId})`
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
  };
}
