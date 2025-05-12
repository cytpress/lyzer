import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
  STUCK_PROCESSING_THRESHOLD_MINUTES,
  JOB_NAME_RESCUER,
  JOB_NAME_ANALYZER, // For logging context in error messages
} from "../_shared/utils.ts";
import type { AnalyzedContentRecord } from "../_shared/types/database.ts";
import type { AnalysisStatus } from "../_shared/types/analysis.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Max number of stuck records to process in a single run of this rescue function.
const RESCUE_LIMIT_PER_RUN = 20;

/**
 * Resets the status of a single stuck analysis record in the database.
 * This function determines the next appropriate status based on attempt counts
 * and updates the record to allow reprocessing by the main analyzer function.
 * It does NOT perform the analysis itself.
 * @param supabase Supabase client instance.
 * @param stuckRecord The partial `AnalyzedContentRecord` identified as stuck.
 * @returns A promise resolving to an object indicating the success of the reset operation.
 */
async function resetStuckAnalysisStatus(
  supabase: SupabaseClient,
  stuckRecord: Pick<
    // Using Pick for the specific fields needed from AnalyzedContentRecord
    AnalyzedContentRecord,
    | "id"
    | "analysis_status"
    | "analysis_attempts"
    | "shortened_analysis_attempts"
    | "error_message" // To preserve context of original error
    | "last_error_type"
    | "parsed_content_url"
  >
): Promise<{ success: boolean; newStatus?: AnalysisStatus; error?: string }> {
  let nextAnalysisAttempts = stuckRecord.analysis_attempts;
  let nextShortenedAnalysisAttempts = stuckRecord.shortened_analysis_attempts;
  let newStatus: AnalysisStatus = "failed"; // Default to 'failed' if no other state applies
  let errorMessageUpdate = `Rescued from stuck '${stuckRecord.analysis_status}' state (presumed timeout/crash).`;
  let lastErrorTypeUpdate = "STUCK_RESCUED"; // General type for rescued items

  // Determine next status based on the stage where it got stuck
  if (stuckRecord.analysis_status === "processing") {
    nextAnalysisAttempts++; // Increment regular attempt count for this "failed" (stuck) attempt
    errorMessageUpdate += ` Regular attempt count now ${nextAnalysisAttempts}.`;
    if (nextAnalysisAttempts < MAX_REGULAR_ATTEMPTS) {
      newStatus = "pending";
      errorMessageUpdate += ` Re-queued for regular analysis by ${JOB_NAME_ANALYZER}.`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_PENDING";
    } else if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
      newStatus = "needs_shortened_retry";
      errorMessageUpdate += ` Regular attempts exhausted. Re-queued for shortened analysis by ${JOB_NAME_ANALYZER}.`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_SHORTENED";
    } else {
      newStatus = "failed"; // All attempts are now exhausted
      errorMessageUpdate += " All analysis attempts now exhausted.";
      lastErrorTypeUpdate = "STUCK_MAX_ATTEMPTS_FAILED";
    }
  } else if (stuckRecord.analysis_status === "processing_shortened") {
    nextShortenedAnalysisAttempts++; // Increment shortened attempt count
    errorMessageUpdate += ` Shortened attempt count now ${nextShortenedAnalysisAttempts}.`;
    if (nextShortenedAnalysisAttempts < MAX_SHORTENED_ATTEMPTS) {
      newStatus = "needs_shortened_retry";
      errorMessageUpdate += ` Re-queued for shortened analysis by ${JOB_NAME_ANALYZER}.`;
      lastErrorTypeUpdate = "STUCK_REQUEUED_SHORTENED"; // Remains in shortened retry queue
    } else {
      newStatus = "failed"; // All shortened attempts are now exhausted
      errorMessageUpdate += " All shortened analysis attempts now exhausted.";
      lastErrorTypeUpdate = "STUCK_MAX_ATTEMPTS_FAILED";
    }
  } else {
    // This case should not be reached due to the `serve` function's query filters.
    console.warn(
      `[${JOB_NAME_RESCUER}] Record ID ${stuckRecord.id} has unexpected status '${stuckRecord.analysis_status}' during rescue attempt.`
    );
    return {
      success: false,
      error: `Unexpected status '${stuckRecord.analysis_status}' encountered during rescue.`,
    };
  }

  // Prepare the database update payload
  const updatePayload: Partial<AnalyzedContentRecord> = {
    analysis_status: newStatus,
    processing_started_at: null, // CRITICAL: Clear the timestamp that marked it as processing/stuck
    analysis_attempts: nextAnalysisAttempts,
    shortened_analysis_attempts: nextShortenedAnalysisAttempts,
    // Prepend rescue message to existing error, preserving context
    error_message: `${errorMessageUpdate} (Original error before stuck: ${
      stuckRecord.error_message || "None recorded"
    })`,
    last_error_type: lastErrorTypeUpdate,
    // `analysis_result` is intentionally not cleared here, to preserve any partial data if useful for debugging
  };

  console.log(
    `[${JOB_NAME_RESCUER}] Attempting to reset status for stuck record ID ${stuckRecord.id} (URL: ${stuckRecord.parsed_content_url}). From: '${stuckRecord.analysis_status}', To: '${newStatus}'.`
  );

  // Perform the database update
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

// --- Main Supabase Edge Function Handler ---
// This function is triggered by a cron schedule to find and reset stuck analysis jobs.
serve(async (_req) => {
  const startTime = Date.now();
  let rescuedCount = 0;
  let failedToRescueCount = 0;
  const errorsThisRun: string[] = []; // Collects errors during this specific run

  console.log(`[${JOB_NAME_RESCUER}] Function execution started.`);
  const supabase = getSupabaseClient();

  try {
    // Calculate the timestamp threshold for identifying stuck jobs
    const thresholdTime = new Date(
      Date.now() - STUCK_PROCESSING_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    console.log(
      `[${JOB_NAME_RESCUER}] Querying for records stuck in 'processing' or 'processing_shortened' since before ${thresholdTime} (Limit: ${RESCUE_LIMIT_PER_RUN}).`
    );

    // Fetch records that are potentially stuck
    const { data: stuckRecords, error: fetchError } = await supabase
      .from("analyzed_contents")
      .select(
        // Select only necessary fields for the resetStuckAnalysisStatus function
        "id, parsed_content_url, analysis_status, analysis_attempts, shortened_analysis_attempts, error_message, last_error_type"
      )
      .in("analysis_status", ["processing", "processing_shortened"]) // Target these specific statuses
      .lt("processing_started_at", thresholdTime) // Check if processing_started_at is older than threshold
      .order("processing_started_at", { ascending: true }) // Process the oldest stuck items first
      .limit(RESCUE_LIMIT_PER_RUN); // Limit the number of records to process per run

    if (fetchError) {
      console.error(
        `[${JOB_NAME_RESCUER}] DB Error fetching stuck records: ${fetchError.message}`
      );
      errorsThisRun.push(`DB fetch error: ${fetchError.message}`);
      // Continue to summary/return, don't halt on fetch error
    }

    if (stuckRecords && stuckRecords.length > 0) {
      console.log(
        `[${JOB_NAME_RESCUER}] Found ${stuckRecords.length} potentially stuck record(s) to reset.`
      );
      // Iterate through each stuck record and attempt to reset its status
      for (const record of stuckRecords) {
        const typedRecord = record as Pick<
          // Type assertion for clarity
          AnalyzedContentRecord,
          | "id"
          | "analysis_status"
          | "analysis_attempts"
          | "shortened_analysis_attempts"
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
            console.error(`[${JOB_NAME_RESCUER}] ${errorMsg}`); // Log specific reset failure
            errorsThisRun.push(errorMsg);
          }
        }
        // Small delay between processing records to avoid overwhelming the database
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
      } // End for loop
    } else if (!fetchError) {
      // Only log "not found" if the fetch itself didn't error
      console.log(
        `[${JOB_NAME_RESCUER}] No stuck records found matching criteria.`
      );
    }
  } catch (error) {
    // Catch any critical, unhandled errors in the main try block
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_RESCUER}] CRITICAL: Unhandled error in main handler:`,
      error, // Log full error object
      error instanceof Error ? error.stack : undefined // Log stack if available
    );
    errorsThisRun.push(`Critical error: ${errorMsg}`);
    // Return 500 for critical failures
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
  } // End main try-catch

  // --- Generate summary message for this run ---
  const duration = (Date.now() - startTime) / 1000;
  let summaryMessage = `Rescue operation finished. Records reset: ${rescuedCount}. Failures during reset: ${failedToRescueCount}.`;
  if (errorsThisRun.length > 0) {
    summaryMessage += ` Encountered ${errorsThisRun.length} error(s).`; // Avoid joining array if empty
  }
  summaryMessage += ` Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME_RESCUER}] ${summaryMessage}`);

  // Return 200 OK, indicating the rescue function itself completed its run.
  // The 'success' field in the response body reflects if any errors occurred during this specific run.
  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0, // Overall success means no system-level errors in this run
      message: summaryMessage,
      details: {
        rescued: rescuedCount,
        failedToRescue: failedToRescueCount,
      },
      errors: errorsThisRun, // Include any specific errors encountered
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
