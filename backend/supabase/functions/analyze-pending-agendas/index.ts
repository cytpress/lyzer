// backend/supabase/functions/analyze-pending-agendas/index.ts
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
  JOB_NAME_ANALYZER,
} from "../_shared/utils.ts";
import type { AnalyzedContentRecord } from "../_shared/types/database.ts";
import { processSingleAnalyzedContent } from "./contentProcessor.ts";

export const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
export const MAX_CONTENT_LENGTH_CHARS = 750000;
export const CONTENT_FETCH_TIMEOUT_MS = 60000;

export const baseGenerationConfig: Partial<GenerationConfig> & {
  thinkingConfig?: { thinkingBudget?: number };
} = {
  temperature: 0.3,
  maxOutputTokens: 60000,
  thinkingConfig: {
    thinkingBudget: 0,
  },
};

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

const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1;
const DB_FETCH_LIMIT = 10;

serve(async (_req) => {
  const startTime = Date.now();
  let geminiAnalysesScheduledThisRun = 0;
  let successfulAnalysesCount = 0;
  let failedOrRetryingCount = 0;
  let skippedByCategoryCount = 0;
  let contentsCheckedCount = 0;
  const errorsThisRun: string[] = [];

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
    `[${JOB_NAME_ANALYZER}] Function started. Model: ${GEMINI_MODEL_NAME}. AI analysis limit/run: ${GEMINI_ANALYSIS_LIMIT_PER_RUN}. DB fetch limit/run: ${DB_FETCH_LIMIT}. Max Regular Attempts: ${MAX_REGULAR_ATTEMPTS}. Thinking Budget: ${
      baseGenerationConfig.thinkingConfig?.thinkingBudget ?? "Default/Off"
    }. Will only process category_code 3.`
  );

  try {
    const limitForFetch = Math.min(
      DB_FETCH_LIMIT,
      GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun > 0
        ? DB_FETCH_LIMIT
        : 0
    );

    let itemsToProcess: AnalyzedContentRecord[] = [];

    if (
      limitForFetch > 0 ||
      geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN
    ) {
      console.log(
        `[${JOB_NAME_ANALYZER}] Fetching up to ${DB_FETCH_LIMIT} 'pending' or retryable 'failed' items to find processable ones...`
      );
      const { data: candidateContents, error: fetchError } = await supabase
        .from("analyzed_contents")
        .select<"*", AnalyzedContentRecord>("*")
        .in("analysis_status", ["pending", "failed"])
        .lt("analysis_attempts", MAX_REGULAR_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(DB_FETCH_LIMIT);

      if (fetchError) {
        console.error(
          `[${JOB_NAME_ANALYZER}] DB Error fetching candidate contents: ${fetchError.message}`
        );
        errorsThisRun.push(
          `DB Error fetching candidates: ${fetchError.message}`
        );
      }
      if (candidateContents && candidateContents.length > 0) {
        itemsToProcess = candidateContents;
        console.log(
          `[${JOB_NAME_ANALYZER}] Found ${itemsToProcess.length} candidate item(s). Will iterate to find category 3 items.`
        );
      } else if (!fetchError) {
        console.log(
          `[${JOB_NAME_ANALYZER}] No 'pending' or retryable 'failed' items found.`
        );
      }
    } else {
      console.log(
        `[${JOB_NAME_ANALYZER}] AI analysis limit reached or no fetch capacity.`
      );
    }

    for (const contentRecord of itemsToProcess) {
      contentsCheckedCount++;

      if (geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
        console.log(
          `[${JOB_NAME_ANALYZER}] AI analysis limit (${GEMINI_ANALYSIS_LIMIT_PER_RUN}) reached. Skipping further processing for ID: ${contentRecord.id}.`
        );
        break;
      }

      const result = await processSingleAnalyzedContent(
        contentRecord,
        supabase,
        geminiApiKey,
        baseGenerationConfig,
        safetySettings
      );

      if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;

      if (result.skippedByCategory) {
        skippedByCategoryCount++;
      } else if (result.finalStatusSet === "completed") {
        successfulAnalysesCount++;
      } else if (result.finalStatusSet !== "skipped") {
        failedOrRetryingCount++;
      }

      if (
        geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
        contentsCheckedCount < itemsToProcess.length
      ) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
      }
    }

    if (
      contentsCheckedCount === 0 &&
      errorsThisRun.length === 0 &&
      itemsToProcess.length === 0
    ) {
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
    `Attempted ${geminiAnalysesScheduledThisRun} AI analysis(es) (for category 3). ` +
    `Results: ${successfulAnalysesCount} completed, ${failedOrRetryingCount} failed/retrying, ${skippedByCategoryCount} skipped (non-category 3 or other skip reasons).`;
  if (errorsThisRun.length > 0) {
    summary += ` Encountered ${errorsThisRun.length} system error(s).`;
  }
  summary += ` Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME_ANALYZER}] Run finished. ${summary}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0,
      message: summary,
      details: {
        checked: contentsCheckedCount,
        aiAttempts: geminiAnalysesScheduledThisRun,
        completed: successfulAnalysesCount,
        failedOrRetrying: failedOrRetryingCount,
        skipped: skippedByCategoryCount,
      },
      errors: errorsThisRun,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
