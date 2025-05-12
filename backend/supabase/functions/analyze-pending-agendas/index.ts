import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  HarmCategory,
  HarmBlockThreshold,
  type GenerationConfig,
  type SafetySetting,
} from "npm:@google/genai";
import {
  getSupabaseClient,
  FETCH_DELAY_MS,
  MAX_REGULAR_ATTEMPTS,
  MAX_SHORTENED_ATTEMPTS,
  JOB_NAME_ANALYZER,
} from "../_shared/utils.ts";
import type { AnalyzedContentRecord } from "../_shared/types/database.ts";
import { processSingleAnalyzedContent } from "./contentProcessor.ts";

// --- Job Configuration ---
export const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17"; // AI model for analysis
export const MAX_CONTENT_LENGTH_CHARS = 750000; // Max characters before content truncation
export const CONTENT_FETCH_TIMEOUT_MS = 60000; // Timeout for fetching external content

// --- Gemini API Configuration ---
// Base config for Gemini generation
export const baseGenerationConfig: Partial<GenerationConfig> & {
  thinkingConfig?: { thinkingBudget?: number };
} = {
  temperature: 0.3,
  maxOutputTokens: 60000,
  thinkingConfig: {
    thinkingBudget: 0, // Set to 0 as per original
  },
};

// Safety settings for Gemini
export const safetySettings: SafetySetting[] = [
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

// --- Job Execution Limits ---
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // Max *new* AI analyses initiated per invocation.
const DB_FETCH_LIMIT = 10; // Max candidate records fetched from DB per invocation.

// --- Main Function Handler ---
serve(async (_req) => {
  const startTime = Date.now();
  // Counters for this run's summary
  let geminiAnalysesScheduledThisRun = 0;
  let successfulAnalysesCount = 0;
  let partiallyCompletedCount = 0;
  let failedOrRetryingCount = 0;
  let skippedByCategoryCount = 0;
  let contentsCheckedCount = 0; // Total records iterated from DB
  const errorsThisRun: string[] = []; // Collects system-level errors

  const supabase = getSupabaseClient();
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiApiKey) {
    console.error(
      `[${JOB_NAME_ANALYZER}] FATAL: GEMINI_API_KEY environment variable is missing!`
    );
    return new Response(
      JSON.stringify({
        success: false,
        message: "Missing GEMINI_API_KEY environment variable!",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(
    `[${JOB_NAME_ANALYZER}] Function started. Model: ${GEMINI_MODEL_NAME}. AI analysis limit/run: ${GEMINI_ANALYSIS_LIMIT_PER_RUN}. DB fetch limit/run: ${DB_FETCH_LIMIT}. Max Regular Attempts: ${MAX_REGULAR_ATTEMPTS}, Max Shortened Attempts: ${MAX_SHORTENED_ATTEMPTS}. Thinking Budget: ${
      baseGenerationConfig.thinkingConfig?.thinkingBudget ?? "Default/Off" // Log actual thinking budget
    }`
  );

  try {
    // Phase 1: Process items needing 'shortened_retry'
    // These are prioritized as they have already failed regular attempts.
    let processedInPhase1 = 0;
    if (geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN) {
      const limitForShortenedFetch = Math.min(
        DB_FETCH_LIMIT,
        GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun
      );

      if (limitForShortenedFetch > 0) {
        console.log(
          `[${JOB_NAME_ANALYZER}] Phase 1: Fetching up to ${limitForShortenedFetch} 'needs_shortened_retry' items...`
        );
        const { data: shortenedRetryContents, error: fetchShortenedError } =
          await supabase
            .from("analyzed_contents")
            .select<"*", AnalyzedContentRecord>("*")
            .eq("analysis_status", "needs_shortened_retry")
            .lt("shortened_analysis_attempts", MAX_SHORTENED_ATTEMPTS)
            .order("updated_at", { ascending: true }) // Process older items first
            .limit(limitForShortenedFetch);

        if (fetchShortenedError) {
          console.error(
            `[${JOB_NAME_ANALYZER}] DB Error (Fetching 'needs_shortened_retry'): ${fetchShortenedError.message}`
          );
          errorsThisRun.push(
            `DB Error (Phase 1 Fetch): ${fetchShortenedError.message}`
          );
        }

        if (shortenedRetryContents && shortenedRetryContents.length > 0) {
          console.log(
            `[${JOB_NAME_ANALYZER}] Found ${shortenedRetryContents.length} item(s) for shortened retry processing.`
          );
          for (const contentRecord of shortenedRetryContents) {
            if (contentsCheckedCount >= DB_FETCH_LIMIT) {
              console.log(
                `[${JOB_NAME_ANALYZER}] DB fetch limit (${DB_FETCH_LIMIT}) reached in Phase 1.`
              );
              break; // Stop iterating if DB fetch limit hit
            }
            contentsCheckedCount++;
            processedInPhase1++;

            if (
              geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN
            ) {
              console.log(
                `[${JOB_NAME_ANALYZER}] AI analysis limit (${GEMINI_ANALYSIS_LIMIT_PER_RUN}) reached. Skipping ID: ${contentRecord.id} (shortened).`
              );
              continue; // Skip AI call, but allow checking other items up to DB_FETCH_LIMIT
            }

            const result = await processSingleAnalyzedContent(
              contentRecord,
              supabase,
              geminiApiKey,
              true, // isShortenedAttempt = true
              baseGenerationConfig,
              safetySettings
            );

            if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;
            if (result.skippedByCategory) skippedByCategoryCount++;
            else if (result.finalStatusSet === "partially_completed")
              partiallyCompletedCount++;
            else if (
              result.finalStatusSet !== "completed" &&
              result.finalStatusSet !== "skipped"
            ) {
              failedOrRetryingCount++;
            }

            if (
              geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
              processedInPhase1 < shortenedRetryContents.length
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, FETCH_DELAY_MS)
              );
            }
          }
        } else if (!fetchShortenedError) {
          // Log only if fetch was successful
          console.log(
            `[${JOB_NAME_ANALYZER}] No eligible 'needs_shortened_retry' items found in Phase 1.`
          );
        }
      } else {
        console.log(
          `[${JOB_NAME_ANALYZER}] Skipping Phase 1: No AI analysis budget or DB fetch capacity.`
        );
      }
    }

    // Phase 2: Process 'pending' or retryable 'failed' items
    // This phase runs if limits were not exhausted in Phase 1.
    let processedInPhase2 = 0;
    const remainingDbFetchLimit = DB_FETCH_LIMIT - contentsCheckedCount;
    const remainingAiBudget =
      GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun;

    if (remainingDbFetchLimit > 0 && remainingAiBudget > 0) {
      const limitForRegularFetch = Math.min(
        remainingDbFetchLimit,
        remainingAiBudget
      );

      console.log(
        `[${JOB_NAME_ANALYZER}] Phase 2: Fetching up to ${limitForRegularFetch} 'pending' or retryable 'failed' items...`
      );
      const { data: regularContents, error: fetchRegularError } = await supabase
        .from("analyzed_contents")
        .select<"*", AnalyzedContentRecord>("*")
        .in("analysis_status", ["pending", "failed"])
        .lt("analysis_attempts", MAX_REGULAR_ATTEMPTS)
        .order("created_at", { ascending: true }) // Process oldest pending first
        .limit(limitForRegularFetch);

      if (fetchRegularError) {
        console.error(
          `[${JOB_NAME_ANALYZER}] DB Error (Fetching 'pending'/'failed'): ${fetchRegularError.message}`
        );
        errorsThisRun.push(
          `DB Error (Phase 2 Fetch): ${fetchRegularError.message}`
        );
      }

      if (regularContents && regularContents.length > 0) {
        console.log(
          `[${JOB_NAME_ANALYZER}] Found ${regularContents.length} item(s) for regular analysis processing.`
        );
        for (const contentRecord of regularContents) {
          if (contentsCheckedCount >= DB_FETCH_LIMIT) {
            console.log(
              `[${JOB_NAME_ANALYZER}] DB fetch limit (${DB_FETCH_LIMIT}) reached in Phase 2.`
            );
            break;
          }
          contentsCheckedCount++;
          processedInPhase2++;

          if (geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
            console.log(
              `[${JOB_NAME_ANALYZER}] AI analysis limit (${GEMINI_ANALYSIS_LIMIT_PER_RUN}) reached. Skipping ID: ${contentRecord.id} (regular).`
            );
            continue;
          }

          const result = await processSingleAnalyzedContent(
            contentRecord,
            supabase,
            geminiApiKey,
            false, // isShortenedAttempt = false
            baseGenerationConfig,
            safetySettings
          );

          if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;
          if (result.skippedByCategory) skippedByCategoryCount++;
          else if (result.finalStatusSet === "completed")
            successfulAnalysesCount++;
          else if (
            result.finalStatusSet !== "partially_completed" &&
            result.finalStatusSet !== "skipped"
          ) {
            failedOrRetryingCount++;
          }

          if (
            geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
            processedInPhase2 < regularContents.length
          ) {
            await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
          }
        }
      } else if (!fetchRegularError) {
        // Log only if fetch was successful
        console.log(
          `[${JOB_NAME_ANALYZER}] No eligible 'pending' or retryable 'failed' items found in Phase 2.`
        );
      }
    } else {
      console.log(
        `[${JOB_NAME_ANALYZER}] Skipping Phase 2: DB fetch limit or AI analysis limit already reached.`
      );
    }

    if (contentsCheckedCount === 0 && errorsThisRun.length === 0) {
      console.log(
        `[${JOB_NAME_ANALYZER}] No content items found matching processing criteria in this run.`
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_ANALYZER}] CRITICAL: Unhandled error in main processing loop:`,
      error
    );
    errorsThisRun.push(`Critical error: ${errorMsg}`);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${errorMsg}`,
        errors: errorsThisRun,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  let summary =
    `Checked ${contentsCheckedCount} DB record(s). ` +
    `Attempted ${geminiAnalysesScheduledThisRun} AI analysis(es). ` +
    `Results: ${successfulAnalysesCount} completed, ${partiallyCompletedCount} partially completed, ${failedOrRetryingCount} failed/retrying, ${skippedByCategoryCount} skipped.`;
  if (errorsThisRun.length > 0) {
    summary += ` Encountered ${errorsThisRun.length} system error(s).`;
  }
  summary += ` Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME_ANALYZER}] Run finished. ${summary}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0, // Overall success depends on system errors
      message: summary,
      details: {
        checked: contentsCheckedCount,
        aiAttempts: geminiAnalysesScheduledThisRun,
        completed: successfulAnalysesCount,
        partiallyCompleted: partiallyCompletedCount,
        failedOrRetrying: failedOrRetryingCount,
        skipped: skippedByCategoryCount,
      },
      errors: errorsThisRun,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
