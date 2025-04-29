import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

// --- 配置 ---
const LY_GAZETTE_API_URL =
  "https://ly.govapi.tw/v2/gazettes?page=1&per_page=50"; // 抓公報列表，可調整 per_page
const LY_AGENDA_API_BASE_URL = "https://ly.govapi.tw/v2/gazettes/";
const AGENDA_PER_PAGE = 100; // 抓議程列表時的分頁大小
const JOB_NAME = "process_ly_gazettes";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_DELAY_MS = 500; // 抓取每個議程內容之間的基礎延遲
const MAX_CONTENT_LENGTH = 100000; // 根據 Gemini 1.5 Pro 調整，但仍需注意 Token 數

const DAILY_GEMINI_LIMIT = 3; // 每次執行最多分析幾個議程
const PENDING_FETCH_LIMIT = 10; // 每次執行最多檢查幾個舊的 pending/failed 議程
const GEMINI_MODEL_NAME = "gemini-1.5-pro-latest"; // 確認這是正確的模型標識符

// --- API 類型定義 ---
interface Gazette {
  卷: number;
  期: number;
  冊別: number;
  發布日期: string;
  公報編號: string;
}
interface GazetteApiResponse {
  total: number;
  gazettes: Gazette[];
}
interface ProcessedUrl {
  type: string;
  no: number;
  url: string;
}
interface GazetteAgenda {
  公報議程編號: string;
  卷: number;
  期: number;
  冊別: number;
  屆: number;
  會期: number;
  會議日期: string[];
  案由: string;
  起始頁碼: number;
  結束頁碼: number;
  處理後公報網址: ProcessedUrl[];
  公報編號: string;
}
interface AgendaApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazetteagendas: GazetteAgenda[];
}

// --- Helper: 帶重試和 User-Agent 的 fetch ---
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  const defaultHeaders = {
    "User-Agent":
      "Mozilla/5.0 (compatible; MyGazetteBot/1.0; +http://your-project-url.com)", // 可自訂 User-Agent
  };
  const requestOptions = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options?.headers,
    },
  };

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[fetchRetry] Attempt ${i + 1} fetching ${url}`); // 增加 fetch 嘗試日誌
      const response = await fetch(url, requestOptions);
      if (response.ok) {
        console.log(`[fetchRetry] Success fetching ${url} on attempt ${i + 1}`);
        return response;
      }
      console.warn(
        `[fetchRetry] Attempt ${i + 1} failed for ${url}: ${response.status} ${
          response.statusText
        }`
      );
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        throw new Error(
          `Client error fetching ${url}: ${response.status} ${response.statusText}`
        );
      }
      // 如果是 5xx 或 429，等待後重試
    } catch (error) {
      console.warn(
        `[fetchRetry] Attempt ${i + 1} failed for ${url} with error:`,
        error.message
      );
      if (i === retries - 1) {
        console.error(`[fetchRetry] Final attempt failed for ${url}.`);
        throw error; // 拋出最終錯誤
      }
    }
    const delay = RETRY_DELAY_MS * Math.pow(2, i);
    console.log(`[fetchRetry] Waiting ${delay}ms before next retry...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // 理論上不會執行到這裡，因為上面循環的 catch 會在最後一次失敗時拋錯
  throw new Error(`Failed to fetch ${url} after ${retries} retries.`);
}

// --- Helper: Gemini 分析 ---
async function analyzeContentWithGemini(
  content: string,
  geminiApiKey: string
): Promise<string | null> {
  if (!content || content.trim().length === 0) {
    console.log("[Gemini] Content is empty, skipping analysis.");
    return null;
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    console.warn(
      `[Gemini] Content is too long (${content.length} chars), truncating to ${MAX_CONTENT_LENGTH}.`
    );
    content = content.substring(0, MAX_CONTENT_LENGTH) + "... (truncated)";
  }
  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME });
    const prompt = `請針對以下立法院公報議程內容，產生一段約 100-200 字的中文摘要：\n\n${content}`;

    console.log(
      `[Gemini] Generating content with model ${GEMINI_MODEL_NAME}...`
    ); // 增加調用前日誌
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log(`[Gemini] Analysis successful for model ${GEMINI_MODEL_NAME}.`);
    return text;
  } catch (error) {
    console.error(
      `[Gemini] Error analyzing content with model ${GEMINI_MODEL_NAME}:`,
      error
    );
    return null;
  }
}

// --- Helper: 處理單個議程的分析 ---
async function processSingleAgendaAnalysis(
  agendaId: string,
  contentUrl: string,
  supabase: SupabaseClient,
  geminiApiKey: string
): Promise<{ success: boolean; analysisPerformed: boolean }> {
  let analysisResultText: string | null = null;
  let finalStatus = "failed";
  let analysisPerformed = false;

  try {
    await supabase
      .from("gazette_agendas")
      .update({ analysis_status: "processing" })
      .eq("agenda_id", agendaId);

    console.log(
      `[${JOB_NAME}] Fetching content (txt) for agenda ${agendaId}: ${contentUrl}`
    );
    const contentResponse = await fetchWithRetry(contentUrl);
    const contentText = await contentResponse.text();

    console.log(
      `[${JOB_NAME}] Analyzing content for agenda ${agendaId} with Gemini...`
    );
    analysisResultText = await analyzeContentWithGemini(
      contentText,
      geminiApiKey
    );
    analysisPerformed = true;

    if (analysisResultText) {
      finalStatus = "completed";
    } else {
      console.warn(
        `[${JOB_NAME}] Gemini analysis failed or returned null for agenda ${agendaId}.`
      );
      // 保持 finalStatus 為 'failed'
    }
    return { success: finalStatus === "completed", analysisPerformed };
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Error during analysis process for agenda ${agendaId} (fetching txt failed or Gemini error):`,
      error.message
    );
    finalStatus = "failed";
    return { success: false, analysisPerformed }; // 分析未執行或 fetch 失敗
  } finally {
    console.log(
      `[${JOB_NAME}] Updating final status for agenda ${agendaId} to: ${finalStatus}`
    );
    const { error: updateAnalysisError } = await supabase
      .from("gazette_agendas")
      .update({
        analysis_result: analysisResultText,
        analysis_status: finalStatus,
        analyzed_at:
          finalStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("agenda_id", agendaId);

    if (updateAnalysisError) {
      console.error(
        `[${JOB_NAME}] Error updating final analysis status for agenda ${agendaId}:`,
        updateAnalysisError.message
      );
    }
  }
}

// --- 主函數 ---
serve(async (req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let processedNewAgendaCount = 0;
  let geminiAnalysesDoneThisRun = 0;
  let successfulAnalysesCount = 0;
  let failedAnalysesCount = 0;
  let skippedNoUrlCount = 0;
  let processedPendingFailedCount = 0;

  try {
    // 1. 初始化客戶端和獲取憑證
    console.log(`[${JOB_NAME}] Function execution started.`);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
      console.error("Missing environment variables!");
      throw new Error(
        "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY env variables."
      );
    }
    const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    console.log(`[${JOB_NAME}] Supabase client initialized.`);

    // 2. 獲取上次處理的最新公報 ID
    console.log(`[${JOB_NAME}] Fetching last processed ID for new gazettes...`);
    const { data: jobState, error: stateError } = await supabase
      .from("job_state")
      .select("last_processed_id")
      .eq("job_name", JOB_NAME)
      .maybeSingle();
    if (stateError) {
      console.error("Error fetching job state:", stateError);
      throw new Error(`Error fetching job state: ${stateError.message}`);
    }
    const lastProcessedIdForNew = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME}] Last processed ID for new gazettes: ${
        lastProcessedIdForNew || "None"
      }`
    );

    // ***** 處理舊的 Pending/Failed 議程 *****
    console.log(
      `[${JOB_NAME}] Checking for older pending/failed agendas (limit ${PENDING_FETCH_LIMIT})...`
    );
    const { data: pendingAgendas, error: pendingError } = await supabase
      .from("gazette_agendas")
      .select("agenda_id, parsed_content_url")
      .in("analysis_status", ["pending", "failed"])
      .not("parsed_content_url", "is", null)
      .order("fetched_at", { ascending: true })
      .limit(PENDING_FETCH_LIMIT);

    if (pendingError) {
      console.error(
        `[${JOB_NAME}] Error fetching pending/failed agendas:`,
        pendingError.message
      );
    } else if (pendingAgendas && pendingAgendas.length > 0) {
      console.log(
        `[${JOB_NAME}] Found ${pendingAgendas.length} pending/failed agendas to potentially process.`
      );
      for (const agenda of pendingAgendas) {
        if (geminiAnalysesDoneThisRun >= DAILY_GEMINI_LIMIT) {
          console.log(
            `[${JOB_NAME}] Daily Gemini limit (${DAILY_GEMINI_LIMIT}) reached. Skipping further pending analysis.`
          );
          break;
        }

        console.log(
          `[${JOB_NAME}] Attempting to re-analyze pending/failed agenda: ${agenda.agenda_id}`
        );
        processedPendingFailedCount++;

        const result = await processSingleAgendaAnalysis(
          agenda.agenda_id,
          agenda.parsed_content_url!,
          supabase,
          geminiApiKey
        );

        if (result.analysisPerformed) {
          geminiAnalysesDoneThisRun++;
          if (result.success) {
            successfulAnalysesCount++;
          } else {
            failedAnalysesCount++;
          }
        } else if (!result.success) {
          // Fetching 失敗等，沒有呼叫 Gemini，但也算處理失敗
          failedAnalysesCount++;
        }
        console.log(
          `[${JOB_NAME}] Waiting ${FETCH_DELAY_MS}ms after processing pending agenda...`
        );
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
      }
    } else {
      console.log(
        `[${JOB_NAME}] No pending/failed agendas with txt URLs found.`
      );
    }
    // ***********************************************

    // 3. 呼叫立法院公報 API 抓取新公報 (如果還有分析額度)
    let latestNewGazetteIdProcessed: string | null = null;

    if (geminiAnalysesDoneThisRun < DAILY_GEMINI_LIMIT) {
      console.log(
        `[${JOB_NAME}] Proceeding to check for new gazettes (Gemini limit not reached: ${geminiAnalysesDoneThisRun}/${DAILY_GEMINI_LIMIT}).`
      );
      console.log(
        `[${JOB_NAME}] Calling LY Gazette API: ${LY_GAZETTE_API_URL}`
      );
      const gazetteApiResponse = await fetchWithRetry(LY_GAZETTE_API_URL);
      const gazetteApiData: GazetteApiResponse =
        await gazetteApiResponse.json();
      console.log(
        `[${JOB_NAME}] Received ${
          gazetteApiData.gazettes?.length || 0
        } gazettes from API.`
      );

      // 4. 找出 *新* 的公報
      const newGazettes: Gazette[] = [];
      if (gazetteApiData.gazettes && gazetteApiData.gazettes.length > 0) {
        console.log(
          `[${JOB_NAME}] DEBUG: Finding new gazettes, comparing against lastProcessedIdForNew: ${lastProcessedIdForNew}`
        );
        for (const gazette of gazetteApiData.gazettes) {
          const currentGazetteId = gazette["公報編號"];
          // console.log(`[${JOB_NAME}] DEBUG: Checking gazette ${currentGazetteId}`); // 可選的更詳細日誌
          if (
            lastProcessedIdForNew &&
            currentGazetteId === lastProcessedIdForNew
          ) {
            console.log(
              `[${JOB_NAME}] DEBUG: Found last processed ID (${lastProcessedIdForNew}), stopping.`
            );
            break;
          }
          newGazettes.push(gazette);
        }
      }
      newGazettes.reverse();
      console.log(
        `[${JOB_NAME}] Found ${newGazettes.length} new gazettes to process.`
      );

      // 5. 處理每個 *新* 公報
      if (newGazettes.length > 0) {
        for (const gazette of newGazettes) {
          const currentGazetteId = gazette["公報編號"];
          console.log(
            `[${JOB_NAME}] Processing NEW Gazette ID: ${currentGazetteId}`
          );
          processedNewGazetteCount++;

          // 5.1 儲存公報基本資料
          const { error: gazetteUpsertError } = await supabase
            .from("gazettes")
            .upsert({
              gazette_id: currentGazetteId,
              volume: gazette["卷"],
              issue: gazette["期"],
              booklet: gazette["冊別"],
              publish_date: gazette["發布日期"],
            });
          if (gazetteUpsertError) {
            console.error(
              `[${JOB_NAME}] Error upserting gazette ${currentGazetteId}:`,
              gazetteUpsertError.message
            );
            continue; // 跳到下一個 gazette
          }

          // ***** 重要：更新追蹤 ID *****
          latestNewGazetteIdProcessed = currentGazetteId;

          // 5.2 抓取該公報的議程
          let currentPage = 1;
          let totalPages = 1;
          const allAgendas: GazetteAgenda[] = [];
          let agendaFetchFailed = false;

          do {
            const agendaApiUrl = `${LY_AGENDA_API_BASE_URL}${currentGazetteId}/agendas?page=${currentPage}&per_page=${AGENDA_PER_PAGE}`;
            console.log(
              `[${JOB_NAME}] Fetching agendas page ${currentPage} for NEW gazette ${currentGazetteId}: ${agendaApiUrl}`
            );
            try {
              const agendaResponse = await fetchWithRetry(agendaApiUrl);
              const agendaData: AgendaApiResponse = await agendaResponse.json();
              if (
                agendaData.gazetteagendas &&
                agendaData.gazetteagendas.length > 0
              ) {
                allAgendas.push(...agendaData.gazetteagendas);
              }
              totalPages = agendaData.total_page || 1;
              currentPage++;
            } catch (agendaFetchError) {
              console.error(
                `[${JOB_NAME}] Failed to fetch agendas page ${currentPage} for ${currentGazetteId}:`,
                agendaFetchError.message
              );
              console.warn(
                `[${JOB_NAME}] Skipping remaining agenda fetching for ${currentGazetteId} due to error.`
              );
              agendaFetchFailed = true;
              break; // 跳出 do...while
            }
          } while (currentPage <= totalPages);

          if (agendaFetchFailed) {
            console.warn(
              `[${JOB_NAME}] Agenda fetching failed for ${currentGazetteId}, continuing to next gazette.`
            );
            continue; // 跳到下一個 gazette
          }

          console.log(
            `[${JOB_NAME}] Fetched total ${allAgendas.length} agendas for NEW gazette ${currentGazetteId}.`
          );

          // 5.3 處理每個新抓取的議程
          for (const agenda of allAgendas) {
            const agendaId = agenda["公報議程編號"];
            processedNewAgendaCount++;

            const txtUrlObj = agenda["處理後公報網址"]?.find(
              (u) => u.type === "txt"
            );
            const contentUrl = txtUrlObj?.url || null;

            const { error: agendaInsertError } = await supabase
              .from("gazette_agendas")
              .upsert(
                {
                  agenda_id: agendaId,
                  gazette_id: currentGazetteId,
                  volume: agenda["卷"],
                  issue: agenda["期"],
                  booklet: agenda["冊別"],
                  session: agenda["屆"],
                  term: agenda["會期"],
                  meeting_dates: agenda["會議日期"],
                  subject: agenda["案由"],
                  start_page: agenda["起始頁碼"],
                  end_page: agenda["結束頁碼"],
                  parsed_content_url: contentUrl, // 存 txt URL 或 null
                  analysis_status: "pending",
                  analysis_result: null,
                  analyzed_at: null,
                },
                { onConflict: "agenda_id" }
              );

            if (agendaInsertError) {
              console.error(
                `[${JOB_NAME}] Error upserting new agenda ${agendaId}:`,
                agendaInsertError.message
              );
              continue; // 跳到下一個 agenda
            }

            if (contentUrl && geminiAnalysesDoneThisRun < DAILY_GEMINI_LIMIT) {
              console.log(
                `[${JOB_NAME}] Attempting immediate analysis for NEW agenda: ${agendaId}`
              );
              const result = await processSingleAgendaAnalysis(
                agendaId,
                contentUrl,
                supabase,
                geminiApiKey
              );
              if (result.analysisPerformed) {
                geminiAnalysesDoneThisRun++;
                if (result.success) successfulAnalysesCount++;
                else failedAnalysesCount++;
              } else if (!result.success) {
                failedAnalysesCount++;
              }
            } else if (!contentUrl) {
              console.warn(
                `[${JOB_NAME}] No txt content URL found for NEW agenda ${agendaId}. Setting status to failed.`
              );
              await supabase
                .from("gazette_agendas")
                .update({
                  analysis_status: "failed",
                  analysis_result: "No txt URL",
                })
                .eq("agenda_id", agendaId);
              skippedNoUrlCount++;
            } else {
              console.log(
                `[${JOB_NAME}] Daily Gemini limit reached. Leaving NEW agenda ${agendaId} as pending.`
              );
              // 保持 pending 狀態
            }
            console.log(
              `[${JOB_NAME}] Waiting ${FETCH_DELAY_MS}ms after processing new agenda...`
            );
            await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
          } // End new agenda loop
        } // End new gazette loop
      } // End if newGazettes.length > 0
    } else {
      console.log(
        `[${JOB_NAME}] Daily Gemini limit already reached (${geminiAnalysesDoneThisRun}/${DAILY_GEMINI_LIMIT}). Skipping check for new gazettes.`
      );
    }

    // 6. 更新 job_state
    if (latestNewGazetteIdProcessed) {
      console.log(
        `[${JOB_NAME}] Updating job state with latest NEW processed ID: ${latestNewGazetteIdProcessed}`
      );
      const { error: updateStateError } = await supabase
        .from("job_state")
        .update({
          last_processed_id: latestNewGazetteIdProcessed,
          last_run_at: new Date().toISOString(),
        })
        .eq("job_name", JOB_NAME);
      if (updateStateError) {
        console.error(
          `[${JOB_NAME}] Error updating job state:`,
          updateStateError
        );
        // 不拋出錯誤，讓函數回傳成功訊息，但記錄錯誤
      } else {
        console.log(`[${JOB_NAME}] Job state updated successfully.`);
      }
    } else {
      console.log(
        `[${JOB_NAME}] No new gazettes processed this run. Updating last run time only.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    }

    // 7. 總結並回傳
    const duration = (Date.now() - startTime) / 1000;
    const summary =
      `Processed ${processedNewGazetteCount} new gazettes, ${processedNewAgendaCount} new agendas fetched. ` +
      `Attempted to re-analyze ${processedPendingFailedCount} old agendas. ` +
      `Gemini Analyses: ${geminiAnalysesDoneThisRun} performed (${successfulAnalysesCount} completed, ${failedAnalysesCount} failed). ` +
      `${skippedNoUrlCount} skipped (no txt url). Duration: ${duration.toFixed(
        2
      )}s.`;
    console.log(`[${JOB_NAME}] Run finished. ${summary}`);

    return new Response(JSON.stringify({ success: true, message: summary }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || "Unknown critical error",
      }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
});
