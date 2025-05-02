import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { fetchWithRetry, FETCH_DELAY_MS } from "../_shared/utils.ts";
import { getAnalysisPrompt, shouldSkipAnalysis } from "../_shared/prompts.ts";

// --- Configuration ---
const JOB_NAME = "analyze-pending-agendas";
const GEMINI_MODEL_NAME = "gemini-2.5-pro-exp-03-25"; // *** 確保模型名稱 ***
const MAX_CONTENT_LENGTH_CHARS = 150000;
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1;
const DB_FETCH_LIMIT = 10;
const CONTENT_FETCH_TIMEOUT_MS = 30000;

// --- Gemini Analysis Helper (修改: 接收 prompt) ---
async function analyzeWithGemini(
  content: string,
  prompt: string,
  apiKey: string
): Promise<string | null> {
  // Content empty check moved to processSingleAgenda before fetching content potentially
  // But keep a basic check here too
  if (!content || content.trim().length === 0) {
    console.warn(`[${JOB_NAME}-Gemini] Received empty content for analysis.`);
    return null; // Or handle as an error upstream? Returning null seems okay.
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME });

    console.log(
      `[${JOB_NAME}-Gemini] Requesting analysis from ${GEMINI_MODEL_NAME}...`
    );
    // --- 使用傳入的完整 prompt ---
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    console.log(`[${JOB_NAME}-Gemini] Analysis successful.`);
    return text || null;
  } catch (error) {
    console.error(`[${JOB_NAME}-Gemini] Error during analysis:`, error);
    // Consider more detailed error inspection here
    return null; // Indicate failure
  }
}

// --- Process Single Agenda Analysis Helper ---
async function processSingleAgenda(
  agenda: {
    agenda_id: string;
    parsed_content_url: string;
    category_code: number | null;
  },
  supabase: SupabaseClient,
  geminiApiKey: string
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  errorMessage?: string;
}> {
  const { agenda_id, parsed_content_url, category_code } = agenda;
  let analysisResultText: string | null = null;
  let finalStatus: "completed" | "failed" = "failed"; // Default to failed
  let analysisPerformed = false;
  let errorMessage: string | undefined = undefined;

  console.log(
    `\n[${JOB_NAME}] Processing Agenda ID: ${agenda_id}, Category: ${category_code}`
  );

  // --- 檢查是否為應跳過的索引類別 ---
  if (shouldSkipAnalysis(category_code)) {
    console.log(
      `[${JOB_NAME}] Agenda ${agenda_id} category (${category_code}) should be skipped. Skipping analysis.`
    );
    analysisResultText = "此類別無需摘要 (例如 索引、未知類別)";
    finalStatus = "completed";

    // 直接更新狀態並返回
    try {
      const { error: updateSkipError } = await supabase
        .from("gazette_agendas")
        .update({
          analysis_status: finalStatus,
          analysis_result: analysisResultText,
          analyzed_at: new Date().toISOString(), // Mark as "analyzed" now
        })
        .eq("agenda_id", agenda_id);
      if (updateSkipError) {
        console.error(
          `[${JOB_NAME}] !!! CRITICAL: Failed to update status for skipped index agenda ${agenda_id}: ${updateSkipError.message}`
        );
        // Even if update fails, we return success=true because the *intended* processing (skipping) is done conceptually.
        // The error log is the important part here.
      } else {
        console.log(
          `[${JOB_NAME}] Marked index agenda ${agenda_id} as completed.`
        );
      }
    } catch (e) {
      console.error(
        `[${JOB_NAME}] !!! CRITICAL: Exception during status update for skipped index agenda ${agenda_id}: ${e.message}`
      );
    }

    return { success: true, analysisPerformed: false }; // Success because skipping is the correct action
  }

  // --- 以下為需要分析的流程 ---
  try {
    // 1. Mark as processing
    console.log(`[${JOB_NAME}] Marking ${agenda_id} as 'processing'...`);
    const { error: updateProcessingError } = await supabase
      .from("gazette_agendas")
      .update({ analysis_status: "processing" })
      .eq("agenda_id", agenda_id);

    if (updateProcessingError) {
      console.warn(
        `[${JOB_NAME}] Failed to mark ${agenda_id} as processing: ${updateProcessingError.message}`
      );
    }

    // 2. Fetch content from TXT URL with timeout
    console.log(`[${JOB_NAME}] Fetching content from: ${parsed_content_url}`);
    let contentText: string;
    let truncated = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CONTENT_FETCH_TIMEOUT_MS
      );

      const contentResponse = await fetchWithRetry(
        parsed_content_url,
        { signal: controller.signal },
        2,
        `${JOB_NAME}-contentFetch`
      );
      clearTimeout(timeoutId);
      contentText = await contentResponse.text();

      // Check and truncate content HERE before passing to prompt generation
      if (contentText.length > MAX_CONTENT_LENGTH_CHARS) {
        console.warn(
          `[${JOB_NAME}] Content for ${agenda_id} length (${contentText.length}) > ${MAX_CONTENT_LENGTH_CHARS}, truncating.`
        );
        contentText = contentText.substring(0, MAX_CONTENT_LENGTH_CHARS);
        truncated = true;
      }

      console.log(
        `[${JOB_NAME}] Fetched content successfully for ${agenda_id} (${(
          contentText.length / 1024
        ).toFixed(1)} KB).${truncated ? " Content was truncated." : ""}`
      );
    } catch (fetchError) {
      if (fetchError.name === "AbortError") {
        console.error(
          `[${JOB_NAME}] Timed out fetching content for ${agenda_id} after ${CONTENT_FETCH_TIMEOUT_MS}ms.`
        );
        throw new Error(`Content fetch timed out`);
      } else {
        console.error(
          `[${JOB_NAME}] Error fetching content for ${agenda_id}: ${fetchError.message}`
        );
        throw fetchError;
      }
    }

    // Ensure content is not empty after fetching
    if (!contentText || contentText.trim().length === 0) {
      console.warn(
        `[${JOB_NAME}] Fetched content for ${agenda_id} is empty. Skipping analysis.`
      );
      throw new Error("Fetched content is empty"); // Treat as processing error
    }

    // 3. Analyze content if fetch was successful
    console.log(
      `[${JOB_NAME}] Analyzing content for ${agenda_id} (Category: ${category_code}) with Gemini...`
    );
    // --- 使用 getAnalysisPrompt 獲取特定 Prompt ---
    const prompt = getAnalysisPrompt(category_code, contentText, truncated);
    analysisResultText = await analyzeWithGemini(
      contentText,
      prompt,
      geminiApiKey
    );
    analysisPerformed = true; // Attempted Gemini call

    if (analysisResultText) {
      finalStatus = "completed";
      console.log(`[${JOB_NAME}] Analysis successful for ${agenda_id}.`);
    } else {
      finalStatus = "failed";
      errorMessage = "Gemini analysis failed or returned empty result.";
      console.warn(`[${JOB_NAME}] ${errorMessage} for ${agenda_id}.`);
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Error during processing pipeline for ${agenda_id}: ${error.message}`
    );
    finalStatus = "failed";
    // Use caught error message if analysisResultText is not set
    errorMessage =
      analysisResultText === null
        ? `Processing error: ${error.message}`
        : errorMessage;
  } finally {
    // 4. Update final status in Supabase ALWAYS
    console.log(
      `[${JOB_NAME}] Updating final status for ${agenda_id} to: ${finalStatus}`
    );
    const updatePayload: any = {
      analysis_status: finalStatus,
      // Store result or error. If analysisResultText exists (even if empty from Gemini), use it. Otherwise use errorMessage.
      analysis_result:
        analysisResultText !== null
          ? analysisResultText
          : errorMessage ?? "Unknown processing error",
    };
    if (finalStatus === "completed") {
      updatePayload.analyzed_at = new Date().toISOString();
    } else {
      updatePayload.analyzed_at = null;
    }

    const { error: updateAnalysisError } = await supabase
      .from("gazette_agendas")
      .update(updatePayload)
      .eq("agenda_id", agenda_id);

    if (updateAnalysisError) {
      console.error(
        `[${JOB_NAME}] !!! CRITICAL: Failed to update final status for ${agenda_id}: ${updateAnalysisError.message}`
      );
      // If the final update fails, the operation wasn't truly successful from DB perspective
      // Override success state if update fails? This is debatable. Let's keep the processing outcome for now.
      // errorMessage = `Processing finished as ${finalStatus}, but DB update failed: ${updateAnalysisError.message}`;
    } else {
      console.log(`[${JOB_NAME}] Final status updated for ${agenda_id}.`);
    }
  }

  return {
    success: finalStatus === "completed",
    analysisPerformed,
    errorMessage,
  };
}

// --- Main Server Handler (修改 DB 查詢) ---
serve(async (req) => {
  const startTime = Date.now();
  let geminiAnalysesAttempted = 0;
  let successfulAnalysesCount = 0;
  let failedProcessingCount = 0;
  let agendasCheckedCount = 0;
  let skippedIndexCount = 0;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error(`[${JOB_NAME}] Missing GEMINI_API_KEY environment variable!`);
    return new Response(
      JSON.stringify({ success: false, message: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(`[${JOB_NAME}] Function execution started.`);

  try {
    // 1. Fetch pending or previously failed agendas - include category_code
    console.log(
      `[${JOB_NAME}] Fetching up to ${DB_FETCH_LIMIT} agendas with status 'pending' or 'failed' and a valid txt URL...`
    );
    const { data: agendasToProcess, error: fetchError } = await supabase
      .from("gazette_agendas")
      .select("agenda_id, parsed_content_url, category_code")
      .in("analysis_status", ["pending", "failed"])
      .not("parsed_content_url", "is", null)
      .order("fetched_at", { ascending: true })
      .limit(DB_FETCH_LIMIT);

    if (fetchError) {
      throw new Error(`Error fetching agendas: ${fetchError.message}`);
    }

    if (!agendasToProcess || agendasToProcess.length === 0) {
      console.log(`[${JOB_NAME}] No suitable agendas found to process.`);
      const duration = (Date.now() - startTime) / 1000;
      return new Response(
        JSON.stringify({
          success: true,
          message: `No agendas to process. Duration: ${duration.toFixed(2)}s.`,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[${JOB_NAME}] Found ${agendasToProcess.length} agendas to potentially process.`
    );

    // 2. Process each agenda, respecting the run limit
    for (const agenda of agendasToProcess) {
      agendasCheckedCount++;

      // Check limit *before* processing, but account for skipped items not hitting Gemini
      // If the agenda is an index category, we don't count it towards the Gemini limit
      if (!shouldSkipAnalysis(agenda.category_code)) {
        if (geminiAnalysesAttempted >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
          console.log(
            `[${JOB_NAME}] Reached Gemini analysis limit for this run (${GEMINI_ANALYSIS_LIMIT_PER_RUN}). Stopping further analysis processing.`
          );
          // Don't break the whole loop, just skip analysis for this item and others
          // Let the loop finish checking all DB_FETCH_LIMIT items in case there are more index items to skip
          continue; // Skip to next agenda item in the fetched list
        }
      }

      const result = await processSingleAgenda(agenda, supabase, geminiApiKey);

      if (result.analysisPerformed) {
        geminiAnalysesAttempted++; // Count actual Gemini calls attempted
      } else if (shouldSkipAnalysis(agenda.category_code)) {
        skippedIndexCount++; // Count skipped index items
      }

      if (result.success) {
        // successfulAnalysesCount should probably only count actual Gemini successes?
        // If skipping counts as success, let's add a separate counter or refine definition.
        // Let's count only actual analysis successes here. Skipped indices are handled separately.
        if (result.analysisPerformed) {
          // Only increment if analysis was done and successful
          successfulAnalysesCount++;
        }
      } else {
        // This counts any failure within processSingleAgenda (fetch, empty content, gemini fail, db update fail implicitly handled by status)
        // unless it's a skipped index item which returns success: true
        failedProcessingCount++;
        console.warn(
          `[${JOB_NAME}] Processing failed for agenda ${
            agenda.agenda_id
          }. Reason: ${result.errorMessage || "Unknown"}`
        );
      }

      // Delay before processing the next agenda (apply delay even if skipped/limit hit?)
      // Let's apply delay regardless to pace the entire function run
      await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
    } // End agenda processing loop
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Log summary and return success
  const duration = (Date.now() - startTime) / 1000;
  const summary =
    `Checked ${agendasCheckedCount} DB rows. ` +
    `Skipped ${skippedIndexCount} agendas (category 6, 7, 9). ` +
    `Attempted ${geminiAnalysesAttempted} Gemini analyses ` +
    `(${successfulAnalysesCount} completed, ${failedProcessingCount} failed processing). ` +
    `Duration: ${duration.toFixed(2)}s.`;
  console.log(`[${JOB_NAME}] Run finished. ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
