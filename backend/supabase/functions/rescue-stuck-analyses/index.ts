// backend/supabase/functions/rescue-stuck-analyses/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  MAX_REGULAR_ATTEMPTS, // This should be 3 according to your new logic
  STUCK_PROCESSING_THRESHOLD_MINUTES,
  JOB_NAME_RESCUER,
  JOB_NAME_ANALYZER,
} from "../_shared/utils.ts";
import type { AnalyzedContentRecord } from "../_shared/types/database.ts";
import type { AnalysisStatus } from "../_shared/types/analysis.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const RESCUE_LIMIT_PER_RUN = 20;

/**
 * Resets the status of a single stuck analysis record.
 * MODIFIED LOGIC: If attempts reach MAX_REGULAR_ATTEMPTS due to rescue, mark as 'failed'.
 */
async function resetStuckAnalysisStatus(
  supabase: SupabaseClient,
  stuckRecord: Pick<
    // Now only needs analysis_attempts from the record for this logic
    AnalyzedContentRecord,
    | "id"
    | "analysis_status"
    | "analysis_attempts"
    | "error_message"
    | "last_error_type"
    | "parsed_content_url"
  >
): Promise<{ success: boolean; newStatus?: AnalysisStatus; error?: string }> {
  const currentAttemptsBeforeRescue = stuckRecord.analysis_attempts;
  const nextAnalysisAttempts = currentAttemptsBeforeRescue + 1; // This rescue counts as an attempt
  let newStatus: AnalysisStatus = "failed"; // Default
  let errorMessageUpdate = `Rescued from stuck '${stuckRecord.analysis_status}' state (presumed timeout/crash).`;
  let lastErrorTypeUpdate = "STUCK_RESCUED";

  if (stuckRecord.analysis_status === "processing") {
    // The 'processing' state implies an attempt was made.
    // The rescue itself effectively marks this attempt as "failed due to being stuck".
    // So, `nextAnalysisAttempts` (which is `currentAttemptsBeforeRescue + 1`)
    // represents the total number of attempts including this stuck one.

    errorMessageUpdate += ` Total attempts including this stuck one: ${nextAnalysisAttempts}.`;

    if (nextAnalysisAttempts < MAX_REGULAR_ATTEMPTS) {
      // If, after counting this stuck attempt, we are still below max attempts,
      // re-queue for another try.
      newStatus = "pending";
      errorMessageUpdate += ` Re-queued for regular analysis by ${JOB_NAME_ANALYZER}.`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_PENDING";
    } else {
      // If counting this stuck attempt reaches or exceeds MAX_REGULAR_ATTEMPTS,
      // then all attempts are considered exhausted. Mark as 'failed'.
      newStatus = "failed";
      errorMessageUpdate += ` Max attempts (${MAX_REGULAR_ATTEMPTS}) reached or exceeded. Marked as failed.`;
      lastErrorTypeUpdate = "STUCK_MAX_ATTEMPTS_FAILED";
    }
  } else {
    console.warn(
      `[${JOB_NAME_RESCUER}] Record ID ${stuckRecord.id} has unexpected status '${stuckRecord.analysis_status}' during rescue attempt.`
    );
    return {
      success: false,
      error: `Unexpected status '${stuckRecord.analysis_status}' encountered during rescue.`,
    };
  }

  const updatePayload: Partial<AnalyzedContentRecord> = {
    analysis_status: newStatus,
    processing_started_at: null,
    analysis_attempts: nextAnalysisAttempts, // Update with the new total attempts
    error_message: `${errorMessageUpdate} (Original error before stuck: ${
      stuckRecord.error_message || "None recorded"
    })`,
    last_error_type: lastErrorTypeUpdate,
  };

  console.log(
    `[${JOB_NAME_RESCUER}] Attempting to reset status for stuck record ID ${stuckRecord.id} (URL: ${stuckRecord.parsed_content_url}). From: '${stuckRecord.analysis_status}', To: '${newStatus}'. Attempts after rescue: ${nextAnalysisAttempts}`
  );

  const { error } = await supabase
    .from("analyzed_contents")
    .update(updatePayload)
    .eq("id", stuckRecord.id);

  if (error) {
    console.error(
      `[${JOB_NAME_RESCUER}] DB Update FAILED for record ID ${stuckRecord.id}: ${error.message}`
    );
    return { success: false, error: `DB Update failed: ${error.message}` };
  }

  console.log(
    `[${JOB_NAME_RESCUER}] Successfully reset status for record ID ${stuckRecord.id} to '${newStatus}'.`
  );
  return { success: true, newStatus };
}

serve(async (_req) => {
  const startTime = Date.now();
  let rescuedCount = 0;
  let failedToRescueCount = 0;
  const errorsThisRun: string[] = [];

  console.log(
    `[${JOB_NAME_RESCUER}] Function execution started. MAX_REGULAR_ATTEMPTS is ${MAX_REGULAR_ATTEMPTS}.`
  );
  const supabase = getSupabaseClient();

  try {
    const thresholdTime = new Date(
      Date.now() - STUCK_PROCESSING_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    console.log(
      `[${JOB_NAME_RESCUER}] Querying for records stuck in 'processing' (or obsolete 'processing_shortened') since before ${thresholdTime} (Limit: ${RESCUE_LIMIT_PER_RUN}).`
    );

    // We only need 'analysis_attempts' to decide the next state accurately.
    // `shortened_analysis_attempts` is no longer relevant for new logic but might exist in old records.
    const { data: stuckRecords, error: fetchError } = await supabase
      .from("analyzed_contents")
      .select(
        "id, parsed_content_url, analysis_status, analysis_attempts, error_message, last_error_type"
      )
      .in("analysis_status", ["processing", "processing_shortened"])
      .lt("processing_started_at", thresholdTime)
      .order("processing_started_at", { ascending: true })
      .limit(RESCUE_LIMIT_PER_RUN);

    if (fetchError) {
      console.error(
        `[${JOB_NAME_RESCUER}] DB Error fetching stuck records: ${fetchError.message}`
      );
      errorsThisRun.push(`DB fetch error: ${fetchError.message}`);
    }

    if (stuckRecords && stuckRecords.length > 0) {
      console.log(
        `[${JOB_NAME_RESCUER}] Found ${stuckRecords.length} potentially stuck record(s) to reset.`
      );
      for (const record of stuckRecords) {
        // Type assertion for clarity, ensure all needed fields from select are here
        const typedRecord = record as Pick<
          AnalyzedContentRecord,
          | "id"
          | "analysis_status"
          | "analysis_attempts"
          | "error_message"
          | "last_error_type"
          | "parsed_content_url"
        >;

        const result = await resetStuckAnalysisStatus(supabase, typedRecord);
        if (result.success) {
          rescuedCount++;
        } else {
          failedToRescueCount++;
          if (result.error) {
            const errorMsg = `Failed to reset status for ID ${typedRecord.id}: ${result.error}`;
            console.error(`[${JOB_NAME_RESCUER}] ${errorMsg}`);
            errorsThisRun.push(errorMsg);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } else if (!fetchError) {
      console.log(
        `[${JOB_NAME_RESCUER}] No stuck records found matching criteria.`
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_RESCUER}] CRITICAL: Unhandled error in main handler:`,
      error,
      error instanceof Error ? error.stack : undefined
    );
    errorsThisRun.push(`Critical error: ${errorMsg}`);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error during execution: ${errorMsg}`,
        details: { rescued: rescuedCount, failedToRescue: failedToRescueCount },
        errors: errorsThisRun,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  let summaryMessage = `Rescue operation finished. Records reset: ${rescuedCount}. Failures during reset: ${failedToRescueCount}.`;
  if (errorsThisRun.length > 0) {
    summaryMessage += ` Encountered ${errorsThisRun.length} error(s).`;
  }
  summaryMessage += ` Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME_RESCUER}] ${summaryMessage}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0,
      message: summaryMessage,
      details: {
        rescued: rescuedCount,
        failedToRescue: failedToRescueCount,
      },
      errors: errorsThisRun,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
