import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { fetchWithRetry, FETCH_DELAY_MS } from "../_shared/utils.ts"; // Use shared delay

// --- Configuration ---
const JOB_NAME = "analyze-pending-agendas";
const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17"; // *** 確認模型名稱 ***
const MAX_CONTENT_LENGTH_CHARS = 150000; // 稍微增加，但仍需注意 Token (Gemini 1.5 Pro context window 很大，但 API 可能有不同限制)
const GEMINI_ANALYSIS_LIMIT_PER_RUN = 1; // 每次執行此 Function 最多處理幾個議程的分析
const DB_FETCH_LIMIT = 10; // 每次從資料庫撈取多少筆待處理議程來檢查
const CONTENT_FETCH_TIMEOUT_MS = 30000; // 抓取 TXT 內容的超時時間 (30秒)

// --- Gemini Analysis Helper ---
async function analyzeWithGemini(
  content: string,
  apiKey: string
): Promise<string | null> {
  if (!content || content.trim().length === 0) {
    console.log(`[${JOB_NAME}-Gemini] Content empty, skipping.`);
    return null;
  }

  let truncated = false;
  let processedContent = content;
  if (processedContent.length > MAX_CONTENT_LENGTH_CHARS) {
    console.warn(
      `[${JOB_NAME}-Gemini] Content length (${processedContent.length}) > ${MAX_CONTENT_LENGTH_CHARS}, truncating.`
    );
    processedContent = content.substring(0, MAX_CONTENT_LENGTH_CHARS);
    truncated = true;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME });
    const prompt = `請針對以下立法院公報議程內容，產生一段約 100-200 字的中文摘要：\n\n${processedContent}${
      truncated ? "\n\n[內容因過長已被截斷]" : ""
    }`;

    console.log(
      `[${JOB_NAME}-Gemini] Requesting analysis from ${GEMINI_MODEL_NAME}...`
    );
    const result = await model.generateContent(prompt);
    const response = result.response; // No need for await here
    const text = response.text();
    console.log(`[${JOB_NAME}-Gemini] Analysis successful.`);
    return text || null; // Return null if Gemini returns empty string
  } catch (error) {
    console.error(`[${JOB_NAME}-Gemini] Error during analysis:`, error);
    // Consider checking error type, e.g., safety filters, rate limits
    // if (error?.response?.promptFeedback?.blockReason) {
    //   console.error(`[${JOB_NAME}-Gemini] Blocked: ${error.response.promptFeedback.blockReason}`);
    //   return `[Analysis blocked: ${error.response.promptFeedback.blockReason}]`; // Store block reason
    // }
    return null; // Indicate failure
  }
}

// --- Process Single Agenda Analysis Helper ---
async function processSingleAgenda(
  agenda: { agenda_id: string; parsed_content_url: string },
  supabase: SupabaseClient,
  geminiApiKey: string
): Promise<{
  success: boolean;
  analysisPerformed: boolean;
  errorMessage?: string;
}> {
  const { agenda_id, parsed_content_url } = agenda;
  let analysisResultText: string | null = null;
  let finalStatus: "completed" | "failed" = "failed"; // Default to failed
  let analysisPerformed = false;
  let errorMessage: string | undefined = undefined;

  console.log(`\n[${JOB_NAME}] Processing Agenda ID: ${agenda_id}`);

  try {
    // 1. Mark as processing
    console.log(`[${JOB_NAME}] Marking ${agenda_id} as 'processing'...`);
    const { error: updateProcessingError } = await supabase
      .from("gazette_agendas")
      .update({ analysis_status: "processing" }) // updated_at handled by trigger
      .eq("agenda_id", agenda_id);

    if (updateProcessingError) {
      // Log warning but attempt to continue, the final update is more critical
      console.warn(
        `[${JOB_NAME}] Failed to mark ${agenda_id} as processing: ${updateProcessingError.message}`
      );
    }

    // 2. Fetch content from TXT URL with timeout
    console.log(`[${JOB_NAME}] Fetching content from: ${parsed_content_url}`);
    let contentText: string;
    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CONTENT_FETCH_TIMEOUT_MS
      );

      const contentResponse = await fetchWithRetry(
        parsed_content_url,
        { signal: controller.signal }, // Pass the signal
        2, // Fewer retries for content fetching? Or keep 3? Let's try 2.
        `${JOB_NAME}-contentFetch`
      );
      clearTimeout(timeoutId); // Clear timeout if fetch succeeded
      contentText = await contentResponse.text();
      console.log(
        `[${JOB_NAME}] Fetched content successfully (${(
          contentText.length / 1024
        ).toFixed(1)} KB).`
      );
    } catch (fetchError) {
      if (fetchError.name === "AbortError") {
        console.error(
          `[${JOB_NAME}] Timed out fetching content for ${agenda_id} after ${CONTENT_FETCH_TIMEOUT_MS}ms.`
        );
        throw new Error(`Content fetch timed out`); // Re-throw specific error
      } else {
        console.error(
          `[${JOB_NAME}] Error fetching content for ${agenda_id}: ${fetchError.message}`
        );
        throw fetchError; // Re-throw other fetch errors
      }
    }

    // 3. Analyze content if fetch was successful
    console.log(
      `[${JOB_NAME}] Analyzing content for ${agenda_id} with Gemini...`
    );
    analysisResultText = await analyzeWithGemini(contentText, geminiApiKey);
    analysisPerformed = true; // Attempted Gemini call

    if (analysisResultText) {
      finalStatus = "completed";
      console.log(`[${JOB_NAME}] Analysis successful for ${agenda_id}.`);
    } else {
      // Gemini failed or returned null/empty
      finalStatus = "failed";
      errorMessage = "Gemini analysis failed or returned empty result.";
      console.warn(`[${JOB_NAME}] ${errorMessage} for ${agenda_id}.`);
    }
  } catch (error) {
    // Catch errors from fetch or Gemini call
    console.error(
      `[${JOB_NAME}] Error during processing pipeline for ${agenda_id}: ${error.message}`
    );
    finalStatus = "failed";
    errorMessage = `Processing error: ${error.message}`;
    // analysisPerformed might be true if Gemini failed, false if fetch failed.
  } finally {
    // 4. Update final status in Supabase ALWAYS
    console.log(
      `[${JOB_NAME}] Updating final status for ${agenda_id} to: ${finalStatus}`
    );
    const updatePayload: any = {
      // Use 'any' for flexibility or define a specific update type
      analysis_status: finalStatus,
      analysis_result:
        analysisResultText ?? errorMessage ?? "Unknown processing error", // Store result or error
    };
    if (finalStatus === "completed") {
      updatePayload.analyzed_at = new Date().toISOString();
    } else {
      // Optionally clear analyzed_at on failure? Or leave it? Let's clear it.
      updatePayload.analyzed_at = null;
    }

    const { error: updateAnalysisError } = await supabase
      .from("gazette_agendas")
      .update(updatePayload)
      .eq("agenda_id", agenda_id);

    if (updateAnalysisError) {
      // This is critical - log it prominently
      console.error(
        `[${JOB_NAME}] !!! CRITICAL: Failed to update final status for ${agenda_id}: ${updateAnalysisError.message}`
      );
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

// --- Main Server Handler ---
serve(async (req) => {
  const startTime = Date.now();
  let geminiAnalysesAttempted = 0;
  let successfulAnalysesCount = 0;
  let failedProcessingCount = 0; // Counts rows where processing failed (fetch or analyze)
  let agendasCheckedCount = 0;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error("Missing GEMINI_API_KEY environment variable!");
    return new Response(
      JSON.stringify({ success: false, message: "Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(`[${JOB_NAME}] Function execution started.`);

  try {
    // 1. Fetch pending or previously failed agendas that have a TXT URL
    console.log(
      `[${JOB_NAME}] Fetching up to ${DB_FETCH_LIMIT} agendas with status 'pending' or 'failed' and a valid txt URL...`
    );
    const { data: agendasToProcess, error: fetchError } = await supabase
      .from("gazette_agendas")
      .select("agenda_id, parsed_content_url")
      .in("analysis_status", ["pending", "failed"]) // Get both pending and failed
      .not("parsed_content_url", "is", null) // Must have a URL
      .order("fetched_at", { ascending: true }) // Process older items first
      // Or order by updated_at to de-prioritize recently failed ones:
      // .order("updated_at", { ascending: true, nullsFirst: true })
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
      if (geminiAnalysesAttempted >= GEMINI_ANALYSIS_LIMIT_PER_RUN) {
        console.log(
          `[${JOB_NAME}] Reached Gemini analysis limit for this run (${GEMINI_ANALYSIS_LIMIT_PER_RUN}). Stopping further processing.`
        );
        break; // Stop processing more agendas in this specific run
      }

      const result = await processSingleAgenda(agenda, supabase, geminiApiKey);

      if (result.analysisPerformed) {
        geminiAnalysesAttempted++; // Count Gemini API calls attempted
      }

      if (result.success) {
        successfulAnalysesCount++;
      } else {
        failedProcessingCount++;
        console.warn(
          `[${JOB_NAME}] Processing failed for agenda ${
            agenda.agenda_id
          }. Reason: ${result.errorMessage || "Unknown"}`
        );
      }

      // Delay before processing the next agenda
      await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
    } // End agenda processing loop
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    // Optionally update job state or log to an external monitoring service here
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
    `Checked ${agendasCheckedCount} DB rows. Attempted ${geminiAnalysesAttempted} Gemini analyses ` +
    `(${successfulAnalysesCount} completed, ${failedProcessingCount} failed processing). ` +
    `Duration: ${duration.toFixed(2)}s.`;
  console.log(`[${JOB_NAME}] Run finished. ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
