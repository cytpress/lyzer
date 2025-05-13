// backend/supabase/functions/analyze-pending-agendas/contentProcessor.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { MAX_REGULAR_ATTEMPTS, JOB_NAME_ANALYZER } from "../_shared/utils.ts"; // Ensure this path is correct
import type {
  AnalysisResultJson,
  GeminiErrorDetail,
  AnalysisStatus,
} from "../_shared/types/analysis.ts"; // Ensure this path is correct
import type { AnalyzedContentRecord } from "../_shared/types/database.ts"; // Ensure this path is correct
import { getAnalysisPrompt, shouldSkipAnalysis } from "./prompts.ts"; // Ensure this path is correct
import { analyzeWithGemini } from "./geminiAnalyzer.ts"; // Ensure this path is correct
import { fetchAndPrepareContent } from "./contentUtils.ts"; // Ensure this path is correct
import {
  MAX_CONTENT_LENGTH_CHARS,
  CONTENT_FETCH_TIMEOUT_MS,
  baseGenerationConfig,
} from "./index.ts"; // Ensure this path is correct
import type { SafetySetting } from "npm:@google/genai";

/**
 * Determines the next analysis status if the current attempt fails.
 * @param currentRegularAttempts Total regular attempts made (including current failure).
 * @returns The next AnalysisStatus.
 */
function determineNextStatusOnFailure(
  currentRegularAttempts: number
): AnalysisStatus {
  if (currentRegularAttempts < MAX_REGULAR_ATTEMPTS) {
    return "pending";
  } else {
    return "failed";
  }
}

export async function processSingleAnalyzedContent(
  contentRecord: AnalyzedContentRecord,
  supabase: SupabaseClient,
  geminiApiKey: string,
  generationConfigParams: typeof baseGenerationConfig,
  safetySettingsParams: SafetySetting[]
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  skippedByCategory: boolean;
  errorMessageForLog?: string;
  finalStatusSet: AnalysisStatus;
  resultObjectStored?: AnalysisResultJson | GeminiErrorDetail;
}> {
  const {
    id: analyzedContentId,
    parsed_content_url,
    analysis_attempts = 0, // Default to 0 if undefined
    analysis_status: current_status_from_db,
  } = contentRecord;

  const uniqueRunId = Math.random().toString(36).substring(2, 8);
  const currentAttemptNumber = analysis_attempts + 1;
  const attemptTypeDisplay = "regular";

  console.log(
    `[${JOB_NAME_ANALYZER}] Starting processing for content ID: ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}, Attempt: ${currentAttemptNumber}/${MAX_REGULAR_ATTEMPTS}), URL: ${parsed_content_url}`
  );

  let analysisResultObject: AnalysisResultJson | GeminiErrorDetail | undefined;
  let finalStatusToUpdate: AnalysisStatus = "failed"; // Default to failed
  let finalCommitteeNames: string[] | null = null; // For storing committee_name array
  let analysisPerformed = false;
  let skippedByCategory = false;
  let errorMessageForDb: string | null = null;
  let lastErrorTypeForDb: string | null = null;
  let nextAnalysisAttempts = analysis_attempts; // Initialize with current attempts

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
        `[${JOB_NAME_ANALYZER}] DB error fetching category_code for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${categoryLookupError.message}. Proceeding, skip logic might be affected.`
      );
    }
    const categoryCodeForPrompt = representativeAgenda?.category_code ?? null;
    console.log(
      `[${JOB_NAME_ANALYZER}] Content ID ${analyzedContentId} (Run ID: ${uniqueRunId}) category_code from DB: ${categoryCodeForPrompt}.`
    );

    if (shouldSkipAnalysis(categoryCodeForPrompt)) {
      console.log(
        `[${JOB_NAME_ANALYZER}] Skipping analysis for ID ${analyzedContentId} (Category: ${categoryCodeForPrompt}, Run ID: ${uniqueRunId}) because it's not category 3.`
      );
      skippedByCategory = true;
      analysisResultObject = {
        error: "Analysis skipped: content category_code is not 3.",
        type: "SKIPPED_BY_CATEGORY_FILTER",
      };
      finalStatusToUpdate = "skipped";
      errorMessageForDb = "Skipped: category_code is not 3.";
      lastErrorTypeForDb = "SKIPPED_BY_CATEGORY_FILTER";
    } else {
      const currentProcessingStatus: AnalysisStatus = "processing";
      if (current_status_from_db !== currentProcessingStatus) {
        await supabase
          .from("analyzed_contents")
          .update({
            analysis_status: currentProcessingStatus,
            processing_started_at: new Date().toISOString(),
            analysis_result: null, // Clear previous results
            error_message: null,
            last_error_type: null,
            committee_name: null, // Clear committee_name when starting processing
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

      const {
        text: contentText,
        truncated,
        error: fetchError,
      } = await fetchAndPrepareContent(
        parsed_content_url,
        MAX_CONTENT_LENGTH_CHARS,
        CONTENT_FETCH_TIMEOUT_MS,
        `${JOB_NAME_ANALYZER}-contentFetch-${uniqueRunId}`
      );

      if (fetchError || contentText === null) {
        errorMessageForDb = `Content fetch error for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${
          fetchError?.message || "Unknown fetch error"
        }`;
        lastErrorTypeForDb = "FETCH_ERROR";
        console.error(`[${JOB_NAME_ANALYZER}] ${errorMessageForDb}`);
        nextAnalysisAttempts = currentAttemptNumber; // Count this as an attempt
        throw fetchError || new Error(errorMessageForDb);
      }

      console.log(
        `[${JOB_NAME_ANALYZER}] Calling Gemini for analysis: ID ${analyzedContentId} (Run ID: ${uniqueRunId}, Type: ${attemptTypeDisplay}, Category: ${categoryCodeForPrompt})...`
      );

      const prompt = getAnalysisPrompt(
        categoryCodeForPrompt,
        contentText,
        truncated
      );

      analysisResultObject = await analyzeWithGemini(
        prompt,
        geminiApiKey,
        contentText,
        generationConfigParams,
        safetySettingsParams
      );
      analysisPerformed = true;

      if (analysisResultObject && !("error" in analysisResultObject)) {
        finalStatusToUpdate = "completed";
        // Handle committee_name as an array from AnalysisResultJson
        if (Array.isArray(analysisResultObject.committee_name)) {
          finalCommitteeNames = analysisResultObject.committee_name.filter(
            (name): name is string => typeof name === "string"
          );
          // If the array was not null but all elements were non-strings, treat as null or empty for DB
          if (
            finalCommitteeNames.length === 0 &&
            analysisResultObject.committee_name.length > 0
          ) {
            console.warn(
              `[${JOB_NAME_ANALYZER}] committee_name from Gemini was an array of non-strings for ID ${analyzedContentId}. Storing as null.`
            );
            finalCommitteeNames = null; // Or [] if DB schema prefers empty array over null
          }
        } else if (analysisResultObject.committee_name === null) {
          finalCommitteeNames = null;
        } else {
          // This case should ideally not happen if Gemini adheres to the schema
          console.warn(
            `[${JOB_NAME_ANALYZER}] committee_name from Gemini was not an array or null for ID ${analyzedContentId}. Received: ${JSON.stringify(
              analysisResultObject.committee_name
            )}. Storing as null.`
          );
          finalCommitteeNames = null;
        }

        console.log(
          `[${JOB_NAME_ANALYZER}] Analysis successful: ID ${analyzedContentId} (Run ID: ${uniqueRunId}). Status: ${finalStatusToUpdate}. Committees: ${
            finalCommitteeNames ? finalCommitteeNames.join(", ") : "N/A"
          }.`
        );
        nextAnalysisAttempts = currentAttemptNumber; // Mark attempt as used
        errorMessageForDb = null;
        lastErrorTypeForDb = null;
      } else {
        const geminiError = analysisResultObject as
          | GeminiErrorDetail
          | undefined;
        errorMessageForDb =
          geminiError?.error || "Unknown Gemini analysis error";
        lastErrorTypeForDb = geminiError?.type || "UNKNOWN_GEMINI_ERROR";
        console.warn(
          `[${JOB_NAME_ANALYZER}] Gemini analysis failed: ID ${analyzedContentId} (Run ID: ${uniqueRunId}). Error: ${errorMessageForDb}, Type: ${lastErrorTypeForDb}`
        );
        nextAnalysisAttempts = currentAttemptNumber; // Mark attempt as used
        finalStatusToUpdate =
          determineNextStatusOnFailure(nextAnalysisAttempts);
        console.log(
          `[${JOB_NAME_ANALYZER}] ID ${analyzedContentId} (${attemptTypeDisplay} attempt ${currentAttemptNumber}) failed analysis. Next status: ${finalStatusToUpdate}. (Reg: ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS})`
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_ANALYZER}] Processing pipeline error (outer catch) for ID ${analyzedContentId} (Run ID: ${uniqueRunId}): ${errorMsg}`
    );
    errorMessageForDb = errorMessageForDb || `Pipeline error: ${errorMsg}`;
    lastErrorTypeForDb = lastErrorTypeForDb || "PIPELINE_ERROR";
    // Ensure attempt is counted if not already done
    if (nextAnalysisAttempts <= analysis_attempts) {
      nextAnalysisAttempts = currentAttemptNumber;
    }
    finalStatusToUpdate = determineNextStatusOnFailure(nextAnalysisAttempts);
    console.log(
      `[${JOB_NAME_ANALYZER}] ID ${analyzedContentId} (${attemptTypeDisplay} attempt ${currentAttemptNumber}) pipeline error. Next status: ${finalStatusToUpdate}. (Reg: ${nextAnalysisAttempts}/${MAX_REGULAR_ATTEMPTS})`
    );
    if (!analysisResultObject || !("error" in analysisResultObject)) {
      analysisResultObject = {
        error: errorMessageForDb,
        type: lastErrorTypeForDb as GeminiErrorDetail["type"],
      };
    }
  } finally {
    let resultToStoreOnDb: AnalysisResultJson | GeminiErrorDetail | null = null;

    if (finalStatusToUpdate === "completed") {
      if (analysisResultObject && !("error" in analysisResultObject)) {
        resultToStoreOnDb = analysisResultObject;
      } else {
        console.error(
          `[${JOB_NAME_ANALYZER}] CRITICAL INCONSISTENCY: Status is ${finalStatusToUpdate} but analysisResultObject is invalid for ID ${analyzedContentId}. Forcing to 'failed'.`
        );
        finalStatusToUpdate = "failed";
        errorMessageForDb =
          (analysisResultObject as GeminiErrorDetail)?.error || // Type assertion
          "Inconsistent state: Successful status with invalid/missing result object.";
        lastErrorTypeForDb =
          (analysisResultObject as GeminiErrorDetail)?.type ||
          "INCONSISTENT_STATE";
        resultToStoreOnDb = {
          error: errorMessageForDb,
          type: lastErrorTypeForDb as GeminiErrorDetail["type"], // Ensure type
        };
      }
    } else if (analysisResultObject && "error" in analysisResultObject) {
      resultToStoreOnDb = analysisResultObject;
    } else if (errorMessageForDb) {
      resultToStoreOnDb = {
        error: errorMessageForDb,
        type: (lastErrorTypeForDb ||
          "UNKNOWN_ERROR_FINAL") as GeminiErrorDetail["type"], // Ensure type
      };
    }

    const updatePayload: Partial<AnalyzedContentRecord> = {
      analysis_status: finalStatusToUpdate,
      analysis_result: resultToStoreOnDb,
      analyzed_at:
        finalStatusToUpdate === "completed" ? new Date().toISOString() : null,
      // This field in DB is now TEXT[]
      committee_name:
        finalStatusToUpdate === "completed" && finalCommitteeNames // Use the processed string array
          ? finalCommitteeNames // Store the array or null
          : null,
      error_message: errorMessageForDb,
      last_error_type: lastErrorTypeForDb,
      analysis_attempts: nextAnalysisAttempts,
      processing_started_at: null, // Always clear this
    };

    console.log(
      `[${JOB_NAME_ANALYZER}] Preparing final DB update for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}), Status: ${finalStatusToUpdate}, Regular Attempts: ${
        updatePayload.analysis_attempts
      }, Committee Names: ${JSON.stringify(
        updatePayload.committee_name
      )}, ErrorType: ${updatePayload.last_error_type}`
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
        `[${JOB_NAME_ANALYZER}] !!! CRITICAL DB UPDATE EXCEPTION for ID: ${analyzedContentId} (Run ID: ${uniqueRunId}): ${
          (updateEx as Error).message
        }`
      );
    }
    console.log(
      `[${JOB_NAME_ANALYZER}] Finished processing content ID: ${analyzedContentId} (Run ID: ${uniqueRunId})`
    );
  }

  return {
    success:
      finalStatusToUpdate === "completed" || finalStatusToUpdate === "skipped",
    analysisPerformed,
    skippedByCategory,
    errorMessageForLog:
      finalStatusToUpdate !== "completed" && finalStatusToUpdate !== "skipped"
        ? errorMessageForDb ||
          "Processing ended in non-successful state without specific error."
        : undefined,
    finalStatusSet: finalStatusToUpdate,
    resultObjectStored: analysisResultObject,
  };
}
