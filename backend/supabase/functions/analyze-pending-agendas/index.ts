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

// --- 核心配置更新至 Gemini 3 (2026/01/19 版本) ---
export const GEMINI_MODEL_NAME = "gemini-3-flash-preview";
export const MAX_CONTENT_LENGTH_CHARS = 750000;
export const CONTENT_FETCH_TIMEOUT_MS = 60000;

/**
 * Gemini 3 生成配置
 * 根據最新文件：
 * 1. 建議 temperature 設為 1.0
 * 2. thinkingBudget 改為 thinkingLevel
 * 3. maxOutputTokens 支援到 64,000
 */
export const baseGenerationConfig: any = {
  temperature: 1.0,
  maxOutputTokens: 64000,
  thinkingConfig: {
    // 選項有: "minimal", "low", "medium", "high"
    // 對於公報摘要這種需要邏輯推理的任務，"high" 是最佳選擇
    thinkingLevel: "high",
  },
};

// 安全設定保持原本嚴格程度
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

// 每次 Cron Job 執行的配額控制
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // 測試穩定後可調高
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
    const errorMsg = "FATAL: GEMINI_API_KEY environment variable is missing!";
    console.error(`[${JOB_NAME_ANALYZER}] ${errorMsg}`);
    return new Response(JSON.stringify({ success: false, message: errorMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(
    `[${JOB_NAME_ANALYZER}] Function started. Model: ${GEMINI_MODEL_NAME}. ` +
      `Thinking Level: ${baseGenerationConfig.thinkingConfig.thinkingLevel}. ` +
      `Max Regular Attempts: ${MAX_REGULAR_ATTEMPTS}.`,
  );

  try {
    // 從資料庫抓取待處理或曾經失敗但未達上限的任務
    console.log(`[${JOB_NAME_ANALYZER}] Querying DB for pending items...`);
    const { data: itemsToProcess, error: fetchError } = await supabase
      .from("analyzed_contents")
      .select<"*", AnalyzedContentRecord>("*")
      .in("analysis_status", ["pending", "failed"])
      .lt("analysis_attempts", MAX_REGULAR_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(DB_FETCH_LIMIT);

    if (fetchError) {
      const errorMsg = `DB Error fetching candidate contents: ${fetchError.message}`;
      console.error(`[${JOB_NAME_ANALYZER}] ${errorMsg}`);
      errorsThisRun.push(errorMsg);
      throw new Error(errorMsg);
    }

    if (!itemsToProcess || itemsToProcess.length === 0) {
      console.log(`[${JOB_NAME_ANALYZER}] No tasks found matching criteria.`);
    } else {
      console.log(
        `[${JOB_NAME_ANALYZER}] Found ${itemsToProcess.length} items to evaluate.`,
      );

      for (const contentRecord of itemsToProcess) {
        contentsCheckedCount++;

        // 檢查是否已達到本次執行的 AI 呼叫上限
        if (geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
          console.log(
            `[${JOB_NAME_ANALYZER}] AI limit reached (${GEMINI_ANALYSIS_LIMIT_PER_RUN}). Stopping.`,
          );
          break;
        }

        // 執行單筆分析
        const result = await processSingleAnalyzedContent(
          contentRecord,
          supabase,
          geminiApiKey,
          baseGenerationConfig,
          safetySettings,
        );

        if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;

        if (result.skippedByCategory) {
          skippedByCategoryCount++;
        } else if (result.finalStatusSet === "completed") {
          successfulAnalysesCount++;
        } else if (result.finalStatusSet !== "skipped") {
          failedOrRetryingCount++;
        }

        // 如果還有額額且不是最後一筆，稍微延遲避免觸發 Rate Limit
        if (
          geminiAnalysesScheduledThisRun < GEMINI_ANALYSIS_LIMIT_PER_RUN &&
          contentsCheckedCount < itemsToProcess.length
        ) {
          await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${JOB_NAME_ANALYZER}] CRITICAL Loop Error:`, error);
    errorsThisRun.push(`Critical: ${errorMsg}`);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${errorMsg}`,
        errors: errorsThisRun,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  const summaryMessage = `Run finished. Checked: ${contentsCheckedCount}, Completed: ${successfulAnalysesCount}, Failed/Retrying: ${failedOrRetryingCount}, Skipped: ${skippedByCategoryCount}. Duration: ${duration.toFixed(2)}s.`;
  console.log(`[${JOB_NAME_ANALYZER}] ${summaryMessage}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0,
      message: summaryMessage,
      details: {
        checked: contentsCheckedCount,
        aiAttempts: geminiAnalysesScheduledThisRun,
        completed: successfulAnalysesCount,
      },
      errors: errorsThisRun,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
