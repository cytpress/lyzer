import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
  JOB_NAME_ANALYZER,
} from "../_shared/utils.ts";
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
  AnalysisStatus,
} from "../_shared/types/analysis.ts";
import type { AnalyzedContentRecord } from "../_shared/types/database.ts";
import {
  getAnalysisPrompt,
  getShortenedAnalysisPrompt,
  shouldSkipAnalysis,
} from "./prompts.ts";
import { analyzeWithGemini } from "./geminiAnalyzer.ts";
import { fetchAndPrepareContent } from "./contentUtils.ts";
import {
  MAX_CONTENT_LENGTH_CHARS,
  CONTENT_FETCH_TIMEOUT_MS,
  baseGenerationConfig,
} from "./index.ts"; // Config from the function's main index file
import type { SafetySetting } from "npm:@google/genai";

/**
 * Determines the next analysis status if the current attempt fails.
 * @param isShortenedAttempt Was the failed attempt using the shortened prompt?
 * @param currentRegularAttempts Total regular attempts made (including current failure).
 * @param currentShortenedAttempts Total shortened attempts made (including current failure).
 * @returns The next AnalysisStatus.
 */
function determineNextStatusOnFailure(
  isShortenedAttempt: boolean,
  currentRegularAttempts: number,
  currentShortenedAttempts: number
): AnalysisStatus {
  if (!isShortenedAttempt) {
    // Failure during a regular attempt
    if (currentRegularAttempts < MAX_REGULAR_ATTEMPTS) {
      return "pending"; // Re-queue for another regular attempt
    } else {
      // Regular attempts exhausted
      if (currentShortenedAttempts < MAX_SHORTENED_ATTEMPTS) {
        return "needs_shortened_retry"; // Move to shortened prompt
      } else {
        return "failed"; // All attempts used
      }
    }
  } else {
    // Failure during a shortened attempt
    if (currentShortenedAttempts < MAX_SHORTENED_ATTEMPTS) {
      return "needs_shortened_retry"; // Re-queue for another shortened attempt
    } else {
      return "failed"; // All shortened attempts used
    }
  }
}

/**
 * Processes a single content record for AI analysis.
 * This function orchestrates fetching content, invoking the Gemini API,
 * handling results, managing analysis states, and updating the database.
 * @param contentRecord The content record to process from `analyzed_contents` table.
 * @param supabase Supabase client instance.
 * @param geminiApiKey API key for Google Gemini.
 * @param isShortenedAttempt Flag indicating if this is a retry with a shortened prompt.
 * @param generationConfigParams Configuration for Gemini model generation.
 * @param safetySettingsParams Safety settings for Gemini model.
 * @returns A promise resolving to an object that summarizes the outcome of the processing.
 */
export async function processSingleAnalyzedContent(
  contentRecord: AnalyzedContentRecord,
  supabase: SupabaseClient,
  geminiApiKey: string,
  isShortenedAttempt: boolean = false,
  generationConfigParams: typeof baseGenerationConfig,
  safetySettingsParams: SafetySetting[]
): Promise<{
  success: boolean; // True if final status is completed, partially_completed, or skipped
  analysisPerformed: boolean; // True if Gemini API was called
  skippedByCategory: boolean; // True if skipped due to category code
  errorMessageForLog?: string; // Error message if not successful
  finalStatusSet: AnalysisStatus; // The status actually set in the DB
  resultObjectStored?: AnalysisResultJson | GeminiErrorDetail; // Result/error stored in DB
}> {
  const {
    id: analyzedContentId,
    parsed_content_url,
    analysis_attempts = 0,
    shortened_analysis_attempts = 0,
    error_message: previous_error_message,
    last_error_type: previous_last_error_type,
    analysis_status: current_status_from_db,
  } = contentRecord;

  const uniqueRunId = Math.random().toString(36).substring(2, 8); // For log correlation

  const actualAttemptTypeIsShortened = isShortenedAttempt;
  let currentAttemptNumberForThisType: number; // 1st regular, 2nd regular, 1st shortened etc.
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
    `[${JOB_NAME_ANALYZER}] Starting processing for content ID: ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}, Attempt: ${currentAttemptNumberForThisType}/${maxAttemptsForThisType}), URL: ${parsed_content_url}`
  );

  // Initialize run-specific state variables
  let analysisResultObject: AnalysisResultJson | GeminiErrorDetail | undefined;
  let finalStatusToUpdate: AnalysisStatus = "failed"; // Default to failed
  let finalCommitteeName: string | null = null;
  let analysisPerformed = false;
  let skippedByCategory = false;
  let errorMessageForDb: string | null = null;
  let lastErrorTypeForDb: string | null = null;

  // These track cumulative attempts for DB update
  let nextAnalysisAttempts = analysis_attempts;
  let nextShortenedAnalysisAttempts = shortened_analysis_attempts;

  try {
    // 1. Fetch category_code to determine if analysis should be skipped or to provide context
    const { data: representativeAgenda, error: categoryLookupError } =
      await supabase
        .from("gazette_agendas") // Assumes this table links parsed_content_url to category_code
        .select("category_code")
        .eq("parsed_content_url", parsed_content_url)
        .limit(1)
        .maybeSingle();

    if (categoryLookupError) {
      console.warn(
        `[${JOB_NAME_ANALYZER}] DB error fetching category_code for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${categoryLookupError.message}. Proceeding.`
      );
    }
    const categoryCodeForPrompt = representativeAgenda?.category_code ?? null;
    console.log(
      `[${JOB_NAME_ANALYZER}] Content ID ${analyzedContentId} (Run ID: ${uniqueRunId}) using category_code: ${categoryCodeForPrompt}.`
    );

    // 2. Check if analysis should be skipped
    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME_ANALYZER}] Skipping analysis for ID ${analyzedContentId} (Category: ${categoryCodeForPrompt}, Run ID: ${uniqueRunId}).`
      );
      skippedByCategory = true;
      analysisResultObject = {
        // Store skip reason
        error: "Analysis skipped based on category code.",
        type: "SKIPPED_BY_CATEGORY",
      };
      finalStatusToUpdate = "skipped";
      errorMessageForDb = "Skipped analysis due to category code.";
      lastErrorTypeForDb = "SKIPPED_BY_CATEGORY";
    } else {
      // --- Analysis proceeds ---
      // 3. Update DB status to 'processing' or 'processing_shortened'
      const currentProcessingStatus: AnalysisStatus =
        actualAttemptTypeIsShortened ? "processing_shortened" : "processing";
      if (current_status_from_db !== currentProcessingStatus) {
        // Avoid redundant DB write
        await supabase
          .from("analyzed_contents")
          .update({
            analysis_status: currentProcessingStatus,
            processing_started_at: new Date().toISOString(),
            analysis_result: null, // Clear previous results/errors
            error_message: null,
            last_error_type: null,
          })
          .eq("id", analyzedContentId);
        console.log(
          `[${JOB_NAME_ANALYZER}] Marked content ID ${analyzedContentId} as '${currentProcessingStatus}' (Run ID: ${uniqueRunId}).`
        );
      } else {
        console.log(
          `[${JOB_NAME_ANALYZER}] Content ID ${analyzedContentId} already in '${currentProcessingStatus}' state (Run ID: ${uniqueRunId}). Proceeding.`
        );
      }

      // 4. Fetch and prepare content text
      const {
        text: contentText,
        truncated,
        error: fetchError,
      } = await fetchAndPrepareContent(
        parsed_content_url,
        MAX_CONTENT_LENGTH_CHARS,
        CONTENT_FETCH_TIMEOUT_MS,
        `${JOB_NAME_ANALYZER}-contentFetch-${uniqueRunId}` // Include run ID in fetch job name for logs
      );

      if (fetchError || contentText === null) {
        errorMessageForDb = `Content fetch error for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${
          fetchError?.message || "Unknown fetch error"
        }`;
        lastErrorTypeForDb = "FETCH_ERROR";
        console.error(`[${JOB_NAME_ANALYZER}] ${errorMessageForDb}`);
        // Increment attempt count due to fetch failure
        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }
        throw fetchError || new Error(errorMessageForDb); // Propagate error to main catch, then finally
      }

      // 5. Call Gemini for analysis
      console.log(
        `[${JOB_NAME_ANALYZER}] Calling Gemini for analysis: ID ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}, Category: ${categoryCodeForPrompt})...`
      );
      const promptInputError =
        previous_error_message ||
        `Previous error type: ${previous_last_error_type || "N/A"}`; // Context for shortened prompt

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
        contentText, // For logging purposes within analyzeWithGemini if needed
        generationConfigParams,
        safetySettingsParams
      );
      analysisPerformed = true; // Mark that AI was called

      // 6. Process Gemini's response
      if (analysisResultObject && !("error" in analysisResultObject)) {
        // --- Analysis SUCCESS ---
        finalStatusToUpdate = actualAttemptTypeIsShortened
          ? "partially_completed"
          : "completed";
        finalCommitteeName =
          typeof analysisResultObject.committee_name === "string"
            ? analysisResultObject.committee_name
            : null;
        console.log(
          `[${JOB_NAME_ANALYZER}] Analysis successful: ID ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}). Status: ${finalStatusToUpdate}. Committee: ${
            finalCommitteeName ?? "N/A"
          }.`
        );
        // Update attempt count on success
        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }
        errorMessageForDb = null; // Clear any previous error messages
        lastErrorTypeForDb = null;
      } else {
        // --- Analysis FAILED (Gemini returned error or parsing failed) ---
        const geminiError = analysisResultObject as
          | GeminiErrorDetail
          | undefined; // May be undefined if analyzeWithGemini itself errored badly
        errorMessageForDb =
          geminiError?.error || "Unknown Gemini analysis error";
        lastErrorTypeForDb = geminiError?.type || "UNKNOWN_GEMINI_ERROR";
        console.warn(
          `[${JOB_NAME_ANALYZER}] Gemini analysis failed: ID ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}). Error: ${errorMessageForDb}, Type: ${lastErrorTypeForDb}`
        );
        // Update attempt count on failure
        if (actualAttemptTypeIsShortened) {
          nextShortenedAnalysisAttempts = currentAttemptNumberForThisType;
        } else {
          nextAnalysisAttempts = currentAttemptNumberForThisType;
        }
        // Determine next status based on this failure
        finalStatusToUpdate = determineNextStatusOnFailure(
          actualAttemptTypeIsShortened,
          nextAnalysisAttempts, // Pass updated counts
          nextShortenedAnalysisAttempts
        );
        console.log(
          `[${JOB_NAME_ANALYZER}] ID ${analyzedContentId} (${attemptTypeDisplay} attempt ${currentAttemptNumberForThisType}) failed analysis. Next status: ${finalStatusToUpdate}. (Reg: ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS}, Short: ${nextShortenedAnalysisAttempts}/${MAX_SHORTENED_ATTEMPTS})`
        );
      }
    }
  } catch (error) {
    // Catches errors from fetchAndPrepareContent or other unhandled exceptions in the try block
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_ANALYZER}] Processing pipeline error (outer catch) for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${errorMsg}`
    );
    errorMessageForDb = errorMessageForDb || `Pipeline error: ${errorMsg}`; // Preserve fetch error if it was set
    lastErrorTypeForDb = lastErrorTypeForDb || "PIPELINE_ERROR";
    // Attempt counts should have been updated at the point of actual error (e.g., fetch failure).
    // Determine final status based on the cumulative attempts.
    finalStatusToUpdate = determineNextStatusOnFailure(
      actualAttemptTypeIsShortened,
      nextAnalysisAttempts, // Use already updated attempt counts
      nextShortenedAnalysisAttempts
    );
    console.log(
      `[${JOB_NAME_ANALYZER}] ID ${analyzedContentId} (${attemptTypeDisplay} attempt ${currentAttemptNumberForThisType}) pipeline error. Next status: ${finalStatusToUpdate}. (Reg: ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS}, Short: ${nextShortenedAnalysisAttempts}/${MAX_SHORTENED_ATTEMPTS})`
    );
    // Ensure an error object is available for storage
    if (!analysisResultObject || !("error" in analysisResultObject)) {
      analysisResultObject = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb as GeminiErrorDetail["type"],
      };
    }
  } finally {
    // --- This block ALWAYS executes to update the database record ---
    let resultToStoreOnDb: AnalysisResultJson | GeminiErrorDetail | null = null;

    if (
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed"
    ) {
      if (analysisResultObject && !("error" in analysisResultObject)) {
        resultToStoreOnDb = analysisResultObject;
      } else {
        // Inconsistency: marked for success, but result object is an error or missing. Force to 'failed'.
        console.error(
          `[${JOB_NAME_ANALYZER}] CRITICAL INCONSISTENCY: Status is ${finalStatusToUpdate} but analysisResultObject is invalid for ID ${analyzedContentId}. Forcing to 'failed'.`
        );
        finalStatusToUpdate = "failed"; // Correct the status
        errorMessageForDb =
          analysisResultObject?.error ||
          "Inconsistent state: Successful status with invalid/missing result object.";
        lastErrorTypeForDb = analysisResultObject?.type || "INCONSISTENT_STATE";
        resultToStoreOnDb = {
          error: errorMessageForDb,
          type: lastErrorTypeForDb,
        };
      }
    } else if (analysisResultObject && "error" in analysisResultObject) {
      // For 'failed', 'pending', 'needs_shortened_retry' states, store the error object.
      resultToStoreOnDb = analysisResultObject;
    } else if (errorMessageForDb) {
      // If no specific error object (e.g., from skip or early pipeline error), create one from messages.
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
        resultToStoreOnDb &&
        !("error" in resultToStoreOnDb)
          ? resultToStoreOnDb.committee_name
          : null,
      error_message: errorMessageForDb,
      last_error_type: lastErrorTypeForDb,
      analysis_attempts: nextAnalysisAttempts,
      shortened_analysis_attempts: nextShortenedAnalysisAttempts,
      processing_started_at: null, // Always clear this timestamp
    };

    // Log before DB update
    console.log(
      `[${JOB_NAME_ANALYZER}] Preparing final DB update for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}), Status: ${finalStatusToUpdate}, Regular Attempts: ${updatePayload.analysis_attempts}, Shortened Attempts: ${updatePayload.shortened_analysis_attempts}, ErrorType: ${updatePayload.last_error_type}`
    );
    if (resultToStoreOnDb) {
      console.log(
        `[${JOB_NAME_ANALYZER}] Analysis result to store: ${
          "error" in resultToStoreOnDb
            ? `Error - ${resultToStoreOnDb.error}`
            : "Successful Analysis Data"
        }`
      );
    }

    try {
      const { error: updateError } = await supabase
        .from("analyzed_contents")
        .update(updatePayload)
        .eq("id", analyzedContentId);
      if (updateError) {
        console.error(
          `[${JOB_NAME_ANALYZER}] !!! CRITICAL DB UPDATE FAILED for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}): ${updateError.message}`
        );
      } else {
        console.log(
          `[${JOB_NAME_ANALYZER}] DB successfully updated for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}) to status ${finalStatusToUpdate}.`
        );
      }
    } catch (updateEx) {
      console.error(
        `[${JOB_NAME_ANALYZER}] !!! CRITICAL DB UPDATE EXCEPTION for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}): ${updateEx.message}`
      );
    }
    console.log(
      `[${JOB_NAME_ANALYZER}] Finished processing content ID: ${analyzedContentId} (Run ID: ${uniqueRunId})`
    );
  } // end finally

  return {
    success:
      finalStatusToUpdate === "completed" ||
      finalStatusToUpdate === "partially_completed" ||
      finalStatusToUpdate === "skipped",
    analysisPerformed,
    skippedByCategory,
    errorMessageForLog:
      finalStatusToUpdate !== "completed" &&
      finalStatusToUpdate !== "partially_completed" &&
      finalStatusToUpdate !== "skipped"
        ? errorMessageForDb ||
          "Processing ended in non-successful state without specific error."
        : undefined,
    finalStatusSet: finalStatusToUpdate,
    resultObjectStored: analysisResultObject,
  };
}
