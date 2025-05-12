import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  AnalyzedContentRecord,
  AnalysisStatus,
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
  STUCK_PROCESSING_THRESHOLD_MINUTES,
  JOB_NAME_RESCUER,
  JOB_NAME_ANALYZER, // 用於日誌中提及被救援任務的原處理者
} from "../_shared/utils.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const RESCUE_LIMIT_PER_RUN = 20; // 每次救援任務處理的卡住記錄上限

async function rescueStuckAnalysis(
  supabase: SupabaseClient,
  stuckRecord: Pick<
    AnalyzedContentRecord,
    | "id"
    | "analysis_status"
    | "analysis_attempts"
    | "shortened_analysis_attempts"
    | "error_message"
    | "last_error_type"
    | "parsed_content_url"
  >
): Promise<{ success: boolean; newStatus?: AnalysisStatus; error?: string }> {
  let nextAnalysisAttempts = stuckRecord.analysis_attempts;
  let nextShortenedAnalysisAttempts = stuckRecord.shortened_analysis_attempts;
  let newStatus: AnalysisStatus = "failed"; // 預設為失敗
  let errorMessageUpdate = `Rescued from stuck '${stuckRecord.analysis_status}' state. Presumed timeout.`;
  let lastErrorTypeUpdate = "STUCK_RESCUED_TIMEOUT";

  if (stuckRecord.analysis_status === "processing") {
    nextAnalysisAttempts++; // 增加常規嘗試次數
    if (nextAnalysisAttempts < MAX_REGULAR_ATTEMPTS) {
      newStatus = "pending";
      errorMessageUpdate += ` Re-queued for regular analysis (attempt ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS}).`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_PENDING";
    } else if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
      newStatus = "needs_shortened_retry";
      errorMessageUpdate += ` Regular attempts exhausted. Re-queued for shortened analysis (shortened attempt ${
        nextShortenedAnalysisAttempts + 1
      }/${MAX_SHORTENED_ATTEMPTS}).`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_SHORTENED";
    } else {
      newStatus = "failed";
      errorMessageUpdate += " All analysis attempts exhausted.";
      lastErrorTypeUpdate = "STUCK_MAX_ATTEMPTS_FAILED";
    }
  } else if (stuckRecord.analysis_status === "processing_shortened") {
    nextShortenedAnalysisAttempts++; // 增加精簡嘗試次數
    if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
      newStatus = "needs_shortened_retry";
      errorMessageUpdate += ` Re-queued for shortened analysis (attempt ${nextShortenedAnalysisAttempts}/${MAX_SHORTENED_ATTEMPTS}).`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_SHORTENED";
    } else {
      newStatus = "failed";
      errorMessageUpdate += " All shortened analysis attempts exhausted.";
      lastErrorTypeUpdate = "STUCK_MAX_ATTEMPTS_FAILED";
    }
  } else {
    // 理論上不應該發生，因為查詢條件限制了 status
    console.warn(
      `[${JOB_NAME_RESCUER}] Record ID ${stuckRecord.id} has unexpected status '${stuckRecord.analysis_status}' for rescue.`
    );
    return {
      success: false,
      error: `Unexpected status '${stuckRecord.analysis_status}'`,
    };
  }

  const updatePayload: Partial<AnalyzedContentRecord> = {
    analysis_status: newStatus,
    processing_started_at: null, // 清除卡住的時間戳
    analysis_attempts: nextAnalysisAttempts,
    shortened_analysis_attempts: nextShortenedAnalysisAttempts,
    // 保留舊的 analysis_result，但更新錯誤信息
    error_message: `${errorMessageUpdate} (Previous error: ${
      stuckRecord.error_message || "N/A"
    })`,
    last_error_type: lastErrorTypeUpdate,
    // analyzed_at 應該保持不變或為 null，因為沒有新的成功分析
  };

  console.log(
    `[${JOB_NAME_RESCUER}] Rescuing ID ${stuckRecord.id} (URL: ${stuckRecord.parsed_content_url}). Current status: ${stuckRecord.analysis_status}, New status: ${newStatus}, Regular attempts: ${nextAnalysisAttempts}, Shortened attempts: ${nextShortenedAnalysisAttempts}.`
  );

  const { error } = await supabase
    .from("analyzed_contents")
    .update(updatePayload)
    .eq("id", stuckRecord.id);

  if (error) {
    console.error(
      `[${JOB_NAME_RESCUER}] Failed to update record ID ${stuckRecord.id}: ${error.message}`
    );
    return { success: false, error: error.message };
  }

  console.log(
    `[${JOB_NAME_RESCUER}] Successfully rescued record ID ${stuckRecord.id}. New status: ${newStatus}.`
  );
  return { success: true, newStatus };
}

serve(async (_req) => {
  const startTime = Date.now();
  let rescuedCount = 0;
  let failedToRescueCount = 0;
  const errorsThisRun: string[] = [];

  console.log(`[${JOB_NAME_RESCUER}] Function execution started.`);
  const supabase = getSupabaseClient();

  try {
    const thresholdTime = new Date(
      Date.now() - STUCK_PROCESSING_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    console.log(
      `[${JOB_NAME_RESCUER}] Looking for records stuck in 'processing' or 'processing_shortened' since before ${thresholdTime}.`
    );

    const { data: stuckRecords, error: fetchError } = await supabase
      .from("analyzed_contents")
      .select(
        "id, parsed_content_url, analysis_status, analysis_attempts, shortened_analysis_attempts, error_message, last_error_type"
      )
      .in("analysis_status", ["processing", "processing_shortened"])
      .lt("processing_started_at", thresholdTime)
      .order("processing_started_at", { ascending: true }) // 優先處理卡住最久的
      .limit(RESCUE_LIMIT_PER_RUN);

    if (fetchError) {
      console.error(
        `[${JOB_NAME_RESCUER}] Error fetching stuck records: ${fetchError.message}`
      );
      errorsThisRun.push(`DB fetch error: ${fetchError.message}`);
      // 即使抓取失敗，也嘗試完成函數並返回錯誤
    }

    if (stuckRecords && stuckRecords.length > 0) {
      console.log(
        `[${JOB_NAME_RESCUER}] Found ${stuckRecords.length} potentially stuck records to rescue.`
      );
      for (const record of stuckRecords) {
        // 類型轉換，因為 select 的返回類型較寬泛
        const typedRecord = record as Pick<
          AnalyzedContentRecord,
          | "id"
          | "analysis_status"
          | "analysis_attempts"
          | "shortened_analysis_attempts"
          | "error_message"
          | "last_error_type"
          | "parsed_content_url"
        >;
        const result = await rescueStuckAnalysis(supabase, typedRecord);
        if (result.success) {
          rescuedCount++;
        } else {
          failedToRescueCount++;
          if (result.error) {
            errorsThisRun.push(
              `Failed to rescue ID ${typedRecord.id}: ${result.error}`
            );
          }
        }
      }
    } else {
      console.log(
        `[${JOB_NAME_RESCUER}] No stuck records found matching criteria.`
      );
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME_RESCUER}] CRITICAL Unhandled error in main handler:`,
      error
    );
    errorsThisRun.push(`Critical error: ${error.message}`);
    // 返回500錯誤
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        rescuedCount,
        failedToRescueCount,
        errors: errorsThisRun,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  let summaryMessage = `Rescue operation completed. Rescued: ${rescuedCount}. Failed to rescue: ${failedToRescueCount}.`;
  if (errorsThisRun.length > 0) {
    summaryMessage += ` Errors encountered: ${errorsThisRun.join("; ")}.`;
  }
  summaryMessage += ` Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME_RESCUER}] ${summaryMessage}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0 && failedToRescueCount === 0,
      message: summaryMessage,
      rescuedCount,
      failedToRescueCount,
      errors: errorsThisRun,
    }),
    {
      status: 200, // 即使有部分救援失敗，Function 本身是成功執行的
      headers: { "Content-Type": "application/json" },
    }
  );
});
