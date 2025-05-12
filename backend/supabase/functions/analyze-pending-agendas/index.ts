// supabase/functions/analyze-pending-contents/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai";
import {
  getSupabaseClient,
  FETCH_DELAY_MS,
  AnalyzedContentRecord,
  GeminiErrorDetail,
} from "../_shared/utils.ts"; // 從 _shared 導入
import { processSingleAnalyzedContent } from "./contentProcessor.ts"; // 從同目錄導入

// --- Configuration (從此處導出，供其他模塊導入) ---
export const JOB_NAME = "analyze-pending-contents";
export const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
export const MAX_CONTENT_LENGTH_CHARS = 750000;
export const CONTENT_FETCH_TIMEOUT_MS = 60000; // 在 utils.ts 中定義了 fetchWithRetry，這裡的超時是針對內容抓取的
// generationConfig 和 safetySettings 在 geminiAnalyzer.ts 中定義和使用，或者在這裡定義並導出

// Gemini Generation Config - 也可以移到 geminiAnalyzer.ts 或 prompts.ts 如果只在那裡用
export const generationConfig = {
  temperature: 0.3,
  maxOutputTokens: 60000,
  responseMimeType: "application/json",
  thinkingConfig: {
    thinkingBudget: 0,
  },
};
// Gemini Safety Settings - 同上
export const safetySettings = [
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

// --- 主配置 ---
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // 每次 Function 運行實際調用 AI 分析的次數
const DB_FETCH_LIMIT = 10; // 每次從 DB 查詢待處理記錄的總上限 (包含兩種類型)
export const MAX_REGULAR_ATTEMPTS = 2;
export const MAX_SHORTENED_ATTEMPTS = 1;

serve(async (_req) => {
  const startTime = Date.now();
  let geminiAnalysesScheduledThisRun = 0;
  let successfulAnalysesCount = 0;
  let partiallyCompletedCount = 0;
  let failedProcessingCount = 0;
  let skippedByCategoryCount = 0;
  let markedForShortenedRetryCount = 0;
  let contentsCheckedCount = 0;
  const errorsThisRun: string[] = [];

  const supabase = getSupabaseClient();
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiApiKey) {
    console.error(`[${JOB_NAME}] Missing GEMINI_API_KEY!`);
    return new Response(
      JSON.stringify({ success: false, message: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(
    `[${JOB_NAME}] Function started. Using model: ${GEMINI_MODEL_NAME}. AI Analysis limit per run: ${GEMINI_ANALYSIS_LIMIT_PER_RUN}. Max regular attempts: ${MAX_REGULAR_ATTEMPTS}, Max shortened attempts: ${MAX_SHORTENED_ATTEMPTS}.`
  );

  try {
    // 階段一：處理需要精簡 Prompt 重試的任務
    if (geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN) {
      const limitForShortenedFetch = Math.min(
        DB_FETCH_LIMIT,
        GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun
      );
      if (limitForShortenedFetch > 0) {
        console.log(
          `[${JOB_NAME}] Phase 1: Fetching up to ${limitForShortenedFetch} contents needing shortened retry...`
        );
        const { data: shortenedRetryContents, error: fetchShortenedError } =
          await supabase
            .from("analyzed_contents")
            .select<"*", AnalyzedContentRecord>("*") // 明確指定類型
            .eq("analysis_status", "needs_shortened_retry")
            .lt("shortened_analysis_attempts", MAX_SHORTENED_ATTEMPTS)
            .order("updated_at", { ascending: true })
            .limit(limitForShortenedFetch);

        if (fetchShortenedError) {
          console.error(
            `[${JOB_NAME}] DB Error fetching shortened_retry contents: ${fetchShortenedError.message}`
          );
          errorsThisRun.push(
            `DB Error (shortened_retry): ${fetchShortenedError.message}`
          );
        }

        if (shortenedRetryContents && shortenedRetryContents.length > 0) {
          console.log(
            `[${JOB_NAME}] Found ${shortenedRetryContents.length} contents for shortened retry.`
          );
          for (const contentRecord of shortenedRetryContents) {
            if (geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN)
              break;
            contentsCheckedCount++;

            const result = await processSingleAnalyzedContent(
              contentRecord,
              supabase,
              geminiApiKey,
              true
            );

            if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;

            if (result.skippedByCategory) skippedByCategoryCount++;
            else if (result.success) partiallyCompletedCount++;
            else failedProcessingCount++;

            if (
              geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
              contentsCheckedCount < DB_FETCH_LIMIT
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, FETCH_DELAY_MS)
              );
            }
          }
        } else {
          console.log(
            `[${JOB_NAME}] No contents found for shortened retry in this run.`
          );
        }
      } else {
        console.log(
          `[${JOB_NAME}] Phase 1: No budget or DB fetch limit left for shortened retry.`
        );
      }
    }

    // 階段二：處理常規的 pending 或可重試的 failed 任務
    const remainingAiBudgetForRegular =
      GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun;
    if (remainingAiBudgetForRegular > 0) {
      const limitForRegularFetch = Math.min(
        remainingAiBudgetForRegular,
        DB_FETCH_LIMIT - contentsCheckedCount
      );

      if (limitForRegularFetch > 0) {
        console.log(
          `[${JOB_NAME}] Phase 2: Fetching up to ${limitForRegularFetch} pending/failed contents for regular analysis...`
        );
        const { data: regularContents, error: fetchRegularError } =
          await supabase
            .from("analyzed_contents")
            .select<"*", AnalyzedContentRecord>("*")
            .in("analysis_status", ["pending", "failed"])
            .lt("analysis_attempts", MAX_REGULAR_ATTEMPTS)
            .order("created_at", { ascending: true }) // 或者按 updated_at 升序處理最早失敗的
            .limit(limitForRegularFetch);

        if (fetchRegularError) {
          console.error(
            `[${JOB_NAME}] DB Error fetching regular contents: ${fetchRegularError.message}`
          );
          errorsThisRun.push(
            `DB Error (regular): ${fetchRegularError.message}`
          );
        }

        if (regularContents && regularContents.length > 0) {
          console.log(
            `[${JOB_NAME}] Found ${regularContents.length} contents for regular analysis.`
          );
          for (const contentRecord of regularContents) {
            if (geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN)
              break;
            contentsCheckedCount++;

            const result = await processSingleAnalyzedContent(
              contentRecord,
              supabase,
              geminiApiKey,
              false
            );

            if (result.skippedByCategory) {
              skippedByCategoryCount++;
            } else if (result.analysisPerformed) {
              geminiAnalysesScheduledThisRun++;
              if (result.success) {
                successfulAnalysesCount++;
              } else if (result.needsShortenedRetry) {
                markedForShortenedRetryCount++;
                console.log(
                  `[${JOB_NAME}] Content ${
                    contentRecord.id
                  } marked for shortened retry. Type: ${
                    (result.resultObjectStored as GeminiErrorDetail)?.type
                  }`
                );
              } else {
                failedProcessingCount++;
                console.warn(
                  `[${JOB_NAME}] Regular analysis FAILED for ${contentRecord.id} (Final status: ${result.finalStatusSet}). Error: ${result.errorMessageForLog}`
                );
              }
            } else if (!result.success && !result.skippedByCategory) {
              failedProcessingCount++;
              console.warn(
                `[${JOB_NAME}] Pre-AI processing FAILED for ${contentRecord.id}. Error: ${result.errorMessageForLog}`
              );
            }

            if (
              geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
              contentsCheckedCount < DB_FETCH_LIMIT
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, FETCH_DELAY_MS)
              );
            }
          }
        } else {
          console.log(
            `[${JOB_NAME}] No pending/failed contents found for regular analysis in this run (or limit for fetching was 0).`
          );
        }
      } else {
        console.log(
          `[${JOB_NAME}] Phase 2: No budget or DB fetch limit left for regular analysis.`
        );
      }
    } else {
      console.log(
        `[${JOB_NAME}] AI analysis limit already reached after phase 1. Skipping phase 2 for regular tasks.`
      );
    }

    if (contentsCheckedCount === 0) {
      console.log(
        `[${JOB_NAME}] No contents were checked in this entire run (neither shortened nor regular).`
      );
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL Main Handler Error:`, error);
    errorsThisRun.push(`Critical error: ${error.message}`);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        errors: errorsThisRun,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  let summary =
    `Checked ${contentsCheckedCount} content URLs. ` +
    `Attempted ${geminiAnalysesScheduledThisRun} AI analyses. ` + // 使用 Attempted 更準確
    `Results: ${successfulAnalysesCount} full success, ${partiallyCompletedCount} partial success (shortened), ${failedProcessingCount} actual fail. ` +
    `${markedForShortenedRetryCount} marked for shortened retry. ` +
    `${skippedByCategoryCount} skipped by category. `;
  if (errorsThisRun.length > 0) {
    summary += `Encountered system errors: ${errorsThisRun.join("; ")}. `;
  }
  summary += `Duration: ${duration.toFixed(2)}s.`;

  console.log(`[${JOB_NAME}] Run finished. ${summary}`);

  return new Response(
    JSON.stringify({ success: true, message: summary, errors: errorsThisRun }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
