// supabase/functions/analyze-pending-contents/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  HarmCategory,
  HarmBlockThreshold,
  type GenerationConfig,
  type SafetySetting,
} from "npm:@google/generative-ai";
import {
  getSupabaseClient,
  FETCH_DELAY_MS,
  AnalyzedContentRecord,
  // GeminiErrorDetail, // 如果在此文件未直接使用，根據 lint 規則可考慮移除或用 _ 别名
} from "../_shared/utils.ts";
import { processSingleAnalyzedContent } from "./contentProcessor.ts";

// --- 配置 ---
export const JOB_NAME = "analyze-pending-contents";
export const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17";
export const MAX_CONTENT_LENGTH_CHARS = 750000;
export const CONTENT_FETCH_TIMEOUT_MS = 60000;
export const MAX_REGULAR_ATTEMPTS = 2;
export const MAX_SHORTENED_ATTEMPTS = 1;

// Gemini Generation Config - 基礎配置
// responseMimeType 和 responseSchema 會在 analyzeWithGemini 內部根據情況添加
// thinkingConfig 已暫時移除，因 SDK GenerationConfig 類型中未直接包含，需查閱最新文檔確認配置方式
export const baseGenerationConfig: Omit<
  GenerationConfig,
  | "responseMimeType"
  | "responseSchema"
  | "candidateCount"
  | "stopSequences"
  | "topP"
  | "topK" // Omit 更多可選但我們沒用的屬性
> = {
  temperature: 0.3,
  maxOutputTokens: 60000, // 仍然需要，以防生成的 JSON 過長
};

// Gemini Safety Settings - 安全設置
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

// --- 主配置 ---
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // 每次 Function 運行實際調用 AI 分析的次數
const DB_FETCH_LIMIT = 10; // 每次從 DB 查詢待處理記錄的總上限 (包含兩種類型)

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
    console.error(`[${JOB_NAME}] 缺少 GEMINI_API_KEY 環境變數！`);
    return new Response(
      JSON.stringify({
        success: false,
        message: "缺少 GEMINI_API_KEY 環境變數！",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(
    `[${JOB_NAME}] Function 已啟動。模型: ${GEMINI_MODEL_NAME}。每次運行 AI 分析上限: ${GEMINI_ANALYSIS_LIMIT_PER_RUN}。最大常規嘗試次數: ${MAX_REGULAR_ATTEMPTS}，最大精簡嘗試次數: ${MAX_SHORTENED_ATTEMPTS}。`
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
          `[${JOB_NAME}] 階段一：正在抓取最多 ${limitForShortenedFetch} 筆需要精簡重試的內容...`
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
            `[${JOB_NAME}] 資料庫錯誤 (抓取精簡重試內容): ${fetchShortenedError.message}`
          );
          errorsThisRun.push(
            `資料庫錯誤 (精簡重試): ${fetchShortenedError.message}`
          );
        }

        if (shortenedRetryContents && shortenedRetryContents.length > 0) {
          console.log(
            `[${JOB_NAME}] 找到 ${shortenedRetryContents.length} 筆內容進行精簡重試。`
          );
          for (const contentRecord of shortenedRetryContents) {
            if (
              geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN
            ) {
              console.log(
                `[${JOB_NAME}] 已達本輪 AI 分析上限，停止處理精簡重試任務。`
              );
              break;
            }
            contentsCheckedCount++;

            const result = await processSingleAnalyzedContent(
              contentRecord,
              supabase,
              geminiApiKey,
              true, // isShortenedAttempt
              baseGenerationConfig, // 傳入基礎配置
              safetySettings // 傳入安全設置
            );

            if (result.analysisPerformed) geminiAnalysesScheduledThisRun++;

            if (result.skippedByCategory) skippedByCategoryCount++;
            else if (result.success)
              partiallyCompletedCount++; // 精簡嘗試成功算作部分完成
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
          console.log(`[${JOB_NAME}] 本輪未找到需要精簡重試的內容。`);
        }
      } else {
        console.log(
          `[${JOB_NAME}] 階段一：沒有剩餘的 AI 分析額度或資料庫抓取上限用於精簡重試。`
        );
      }
    }

    // 階段二：處理常規的 pending 或可重試的 failed 任務
    const remainingAiBudgetForRegular =
      GEMINI_ANALYSIS_LIMIT_PER_RUN - geminiAnalysesScheduledThisRun;
    if (remainingAiBudgetForRegular > 0) {
      const limitForRegularFetch = Math.min(
        remainingAiBudgetForRegular,
        DB_FETCH_LIMIT - contentsCheckedCount // 減去已檢查的數量
      );

      if (limitForRegularFetch > 0) {
        console.log(
          `[${JOB_NAME}] 階段二：正在抓取最多 ${limitForRegularFetch} 筆待處理/失敗的內容進行常規分析...`
        );
        const { data: regularContents, error: fetchRegularError } =
          await supabase
            .from("analyzed_contents")
            .select<"*", AnalyzedContentRecord>("*") // 明確指定類型
            .in("analysis_status", ["pending", "failed"])
            .lt("analysis_attempts", MAX_REGULAR_ATTEMPTS)
            .order("created_at", { ascending: true }) // 或者按 updated_at 升序處理最早失敗的
            .limit(limitForRegularFetch);

        if (fetchRegularError) {
          console.error(
            `[${JOB_NAME}] 資料庫錯誤 (抓取常規內容): ${fetchRegularError.message}`
          );
          errorsThisRun.push(`資料庫錯誤 (常規): ${fetchRegularError.message}`);
        }

        if (regularContents && regularContents.length > 0) {
          console.log(
            `[${JOB_NAME}] 找到 ${regularContents.length} 筆內容進行常規分析。`
          );
          for (const contentRecord of regularContents) {
            if (
              geminiAnalysesScheduledThisRun >= GEMINI_ANALYSIS_LIMIT_PER_RUN
            ) {
              console.log(
                `[${JOB_NAME}] 已達本輪 AI 分析上限，停止處理常規任務。`
              );
              break;
            }
            contentsCheckedCount++;

            const result = await processSingleAnalyzedContent(
              contentRecord,
              supabase,
              geminiApiKey,
              false, // isShortenedAttempt
              baseGenerationConfig, // 傳入基礎配置
              safetySettings // 傳入安全設置
            );

            if (result.skippedByCategory) {
              skippedByCategoryCount++;
            } else if (result.analysisPerformed) {
              geminiAnalysesScheduledThisRun++;
              if (result.success) {
                successfulAnalysesCount++;
              } else if (result.needsShortenedRetry) {
                markedForShortenedRetryCount++;
                // 相關日誌已在 processSingleAnalyzedContent 中打印
              } else {
                failedProcessingCount++;
                // 相關日誌已在 processSingleAnalyzedContent 中打印
              }
            } else if (!result.success && !result.skippedByCategory) {
              // AI 分析前的處理失敗 (例如內容抓取失敗)
              failedProcessingCount++;
              // 相關日誌已在 processSingleAnalyzedContent 中打印
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
            `[${JOB_NAME}] 本輪未找到待處理/失敗的內容進行常規分析 (或抓取上限為0)。`
          );
        }
      } else {
        console.log(
          `[${JOB_NAME}] 階段二：沒有剩餘的 AI 分析額度或資料庫抓取上限用於常規分析。`
        );
      }
    } else {
      console.log(
        `[${JOB_NAME}] AI 分析上限已在階段一後達到。跳過階段二的常規任務。`
      );
    }

    if (contentsCheckedCount === 0) {
      console.log(
        `[${JOB_NAME}] 本次運行未檢查任何內容 (無論是精簡重試還是常規任務)。`
      );
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL 主處理程序錯誤:`, error);
    errorsThisRun.push(`嚴重錯誤: ${error.message}`);
    return new Response(
      JSON.stringify({
        success: false,
        message: `嚴重錯誤: ${error.message}`,
        errors: errorsThisRun,
        stack: error.stack, // 開發時可包含堆疊追蹤
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = (Date.now() - startTime) / 1000;
  let summary =
    `已檢查 ${contentsCheckedCount} 個內容網址。` +
    `嘗試進行 ${geminiAnalysesScheduledThisRun} 次 AI 分析。` +
    `結果: ${successfulAnalysesCount} 次完全成功, ${partiallyCompletedCount} 次部分成功 (精簡), ${failedProcessingCount} 次實際失敗。` +
    `${markedForShortenedRetryCount} 筆標記為精簡重試。` +
    `${skippedByCategoryCount} 筆因類別跳過。`;
  if (errorsThisRun.length > 0) {
    summary += `發生系統錯誤: ${errorsThisRun.join("; ")}。`;
  }
  summary += `執行時間: ${duration.toFixed(2)} 秒。`;

  console.log(`[${JOB_NAME}] 運行結束。${summary}`);

  return new Response(
    JSON.stringify({ success: true, message: summary, errors: errorsThisRun }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
