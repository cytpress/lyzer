// supabase/functions/fetch-new-gazettes/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  fetchWithRetry,
  isValidDateString,
  Gazette,
  GazetteApiResponse,
  GazetteAgenda,
  AgendaApiResponse,
  GazetteRecord,
  GazetteAgendaRecord, // 使用調整後的定義
  FETCH_DELAY_MS,
  getSupabaseClient,
} from "../_shared/utils.ts"; // 確認路徑正確

// --- Configuration ---
const JOB_NAME = "fetch-new-gazettes";
const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
const GAZETTES_PER_PAGE = 50; // 可調整
const AGENDAS_PER_PAGE = 100; // 可調整

serve(async (req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteId: string | null = null;
  let newUrlsAddedToAnalysisQueue = 0;
  let totalAgendasSaved = 0;
  let totalAgendaFetchErrors = 0;
  let totalAgendaSaveErrors = 0;
  let totalAnalysisQueueErrors = 0;

  const supabase = getSupabaseClient();
  console.log(`[${JOB_NAME}] Function execution started.`);

  try {
    // 1. 獲取上次處理的 gazette ID
    console.log(`[${JOB_NAME}] Fetching last processed ID...`);
    const { data: jobState, error: stateError } = await supabase
      .from("job_state")
      .select("last_processed_id")
      .eq("job_name", JOB_NAME)
      .maybeSingle();

    if (stateError) {
      console.warn(
        `[${JOB_NAME}] Warn: Error fetching job state: ${stateError.message}. Proceeding assuming first run.`
      );
    }
    const lastProcessedId = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME}] Last processed Gazette ID: ${lastProcessedId || "None"}`
    );

    // 2. 抓取最新的公報列表 (第一頁)
    const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
    console.log(`[${JOB_NAME}] Fetching recent gazettes: ${gazetteListUrl}`);
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // API 延遲
    const gazetteApiResponse = await fetchWithRetry(
      gazetteListUrl,
      undefined,
      3,
      JOB_NAME
    );
    const gazetteApiData: GazetteApiResponse = await gazetteApiResponse.json();
    console.log(
      `[${JOB_NAME}] Received ${
        gazetteApiData.gazettes?.length || 0
      } gazettes (Page 1).`
    );

    // 3. 過濾出需要處理的新公報
    const newGazettesToProcess: Gazette[] = [];
    if (gazetteApiData.gazettes?.length > 0) {
      for (const gazette of gazetteApiData.gazettes) {
        // 如果遇到上次成功處理的 ID，則停止添加後續（更新的）公報
        if (lastProcessedId && gazette.公報編號 === lastProcessedId) {
          console.log(
            `[${JOB_NAME}] Reached last processed ID (${lastProcessedId}). Stopping gazette check.`
          );
          break;
        }
        newGazettesToProcess.push(gazette);
      }
    }

    // 反轉列表，從最舊的新公報開始處理
    newGazettesToProcess.reverse();
    console.log(
      `[${JOB_NAME}] Found ${newGazettesToProcess.length} new gazettes to process since last run.`
    );

    // 如果沒有新公報，提前退出
    if (newGazettesToProcess.length === 0) {
      console.log(
        `[${JOB_NAME}] No new gazettes found. Updating run time and exiting.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. 處理每個新的公報
    const uniqueUrlsToAdd = new Set<string>(); // 用於收集本次運行發現的新的、唯一的 txt URL

    for (const gazette of newGazettesToProcess) {
      const currentGazetteId = gazette.公報編號;
      console.log(
        `\n[${JOB_NAME}] Processing NEW Gazette ID: ${currentGazetteId} (Publish Date: ${gazette.發布日期})`
      );
      processedNewGazetteCount++;
      let gazetteProcessingErrorOccurred = false; // 標記此公報處理過程中是否出錯

      // 4.1 更新或插入公報元數據到 'gazettes' 表
      const gazetteRecord: GazetteRecord = {
        gazette_id: currentGazetteId,
        volume: gazette.卷,
        issue: gazette.期,
        booklet: gazette.冊別,
        publish_date: isValidDateString(gazette.發布日期)
          ? gazette.發布日期
          : null,
        // fetched_at 由 DB DEFAULT 管理
      };
      const { error: gazetteUpsertError } = await supabase
        .from("gazettes")
        .upsert(gazetteRecord, { onConflict: "gazette_id" });

      if (gazetteUpsertError) {
        console.error(
          `[${JOB_NAME}] Error upserting gazette record ${currentGazetteId}: ${gazetteUpsertError.message}. Skipping its agendas.`
        );
        gazetteProcessingErrorOccurred = true;
        continue; // 處理下一個公報
      }
      console.log(
        `[${JOB_NAME}] Upserted gazette record for ${currentGazetteId}.`
      );

      // 4.2 抓取此公報的所有議程，處理分頁
      let currentPage = 1;
      let totalPages = 1;
      const allAgendasForThisGazette: GazetteAgenda[] = [];
      let agendaFetchFailed = false;

      console.log(
        `[${JOB_NAME}] Starting to fetch agendas for gazette ${currentGazetteId}...`
      );
      do {
        const agendaApiUrl = `${LY_GAZETTE_API_URL_BASE}/${currentGazetteId}/agendas?page=${currentPage}&per_page=${AGENDAS_PER_PAGE}`;
        console.log(
          `[${JOB_NAME}] Fetching agendas page ${currentPage}/${
            totalPages === 1 && currentPage === 1 ? "?" : totalPages
          } from: ${agendaApiUrl}`
        );

        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // API 延遲

        try {
          const agendaResponse = await fetchWithRetry(
            agendaApiUrl,
            undefined,
            3,
            JOB_NAME
          );
          const agendaData: AgendaApiResponse = await agendaResponse.json();

          if (agendaData.gazetteagendas?.length > 0) {
            allAgendasForThisGazette.push(...agendaData.gazetteagendas);
          } else if (currentPage === 1) {
            console.log(
              `[${JOB_NAME}] No agendas listed in API response for ${currentGazetteId}.`
            );
          }

          if (currentPage === 1) {
            totalPages = agendaData.total_page || 1;
            console.log(
              `[${JOB_NAME}] Total pages of agendas reported by API for ${currentGazetteId}: ${totalPages}`
            );
          }
          currentPage++;
        } catch (fetchError) {
          console.error(
            `[${JOB_NAME}] CRITICAL: Failed to fetch agendas page ${
              currentPage - 1
            } for ${currentGazetteId}: ${
              fetchError.message
            }. Stopping agenda fetch for this gazette.`
          );
          totalAgendaFetchErrors++;
          agendaFetchFailed = true;
          gazetteProcessingErrorOccurred = true;
          break; // 退出 do-while 循環
        }
      } while (currentPage <= totalPages);

      if (agendaFetchFailed) {
        console.warn(
          `[${JOB_NAME}] Agenda fetching may be incomplete for ${currentGazetteId}. Processing ${allAgendasForThisGazette.length} fetched agendas.`
        );
      } else {
        console.log(
          `[${JOB_NAME}] Successfully fetched all ${allAgendasForThisGazette.length} listed agendas for ${currentGazetteId}.`
        );
      }

      // --- 4.3 處理並更新/插入每個議程的元數據到 'gazette_agendas' ---
      let agendasSavedForThisGazette = 0;
      for (const agenda of allAgendasForThisGazette) {
        fetchedNewAgendaCount++;
        const agendaId = agenda.公報議程編號;
        const txtUrlObj = agenda.處理後公報網址?.find((u) => u.type === "txt");
        const txtUrl = txtUrlObj?.url || null; // 獲取 txt URL

        // 如果存在有效的 txt URL，將其加入待處理 Set
        if (txtUrl) {
          uniqueUrlsToAdd.add(txtUrl);
        } else {
          console.warn(`[${JOB_NAME}] Agenda ${agendaId}: No 'txt' URL found.`);
        }

        // 驗證會議日期格式
        const validMeetingDates =
          agenda.會議日期?.filter(isValidDateString) || null;
        if (
          agenda.會議日期 &&
          (!validMeetingDates ||
            validMeetingDates.length !== agenda.會議日期.length)
        ) {
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: Filtered potentially invalid meeting dates. Original: ${JSON.stringify(
              agenda.會議日期
            )}, Validated: ${JSON.stringify(validMeetingDates)}`
          );
        }

        // 準備 gazette_agendas 記錄 (只包含元數據)
        const agendaRecord: GazetteAgendaRecord = {
          agenda_id: agendaId,
          gazette_id: currentGazetteId,
          volume: agenda.卷 ?? null,
          issue: agenda.期 ?? null,
          booklet: agenda.冊別 ?? null,
          session: agenda.屆 ?? null,
          term: agenda.會期 ?? null,
          meeting_dates: validMeetingDates,
          subject: agenda.案由 ?? null,
          category_code: agenda.類別代碼 ?? null,
          start_page: agenda.起始頁碼 ?? null,
          end_page: agenda.結束頁碼 ?? null,
          parsed_content_url: txtUrl, // 存儲 URL 以便關聯
          official_page_url: agenda.公報網網址 ?? null,
          official_pdf_url: agenda.公報完整PDF網址 ?? null,
          // fetched_at 和 updated_at 由 DB 管理
        };

        // 更新或插入議程元數據記錄
        const { error: agendaUpsertError } = await supabase
          .from("gazette_agendas")
          .upsert(agendaRecord, { onConflict: "agenda_id" }); // 按 agenda_id 進行 upsert

        if (agendaUpsertError) {
          totalAgendaSaveErrors++;
          gazetteProcessingErrorOccurred = true;
          console.error(
            `[${JOB_NAME}] Error upserting agenda metadata ${agendaId}: ${agendaUpsertError.message}`
          );
        } else {
          agendasSavedForThisGazette++;
          totalAgendasSaved++;
        }
      } // 結束議程處理循環

      console.log(
        `[${JOB_NAME}] Finished processing agenda metadata for gazette ${currentGazetteId}. Saved ${agendasSavedForThisGazette} / ${allAgendasForThisGazette.length} records.`
      );

      // 僅在當前公報所有步驟都無錯誤時，才更新 latestSuccessfullyProcessedGazetteId
      if (!gazetteProcessingErrorOccurred) {
        latestSuccessfullyProcessedGazetteId = currentGazetteId;
        console.log(
          `[${JOB_NAME}] Successfully processed all parts for Gazette ID: ${currentGazetteId}. Marked as latest success.`
        );
      } else {
        console.warn(
          `[${JOB_NAME}] Gazette ${currentGazetteId} encountered errors during processing. It will NOT be marked as the latest successfully processed ID.`
        );
      }
    } // 結束公報處理循環

    // --- 5. 批量將新的唯一 URL 加入分析隊列 (修正) ---
    if (uniqueUrlsToAdd.size > 0) {
      console.log(
        `\n[${JOB_NAME}] Found ${uniqueUrlsToAdd.size} unique new URLs to add to analysis queue.`
      );
      const recordsToUpsert = Array.from(uniqueUrlsToAdd).map((url) => ({
        parsed_content_url: url,
        // analysis_status 預設為 'pending' (由 DB DEFAULT 設定)
        // 其他欄位如 id, created_at, updated_at 由 DB 自動處理
      }));

      // <<< 修改：使用 upsert 並設定 ignoreDuplicates >>>
      const { error: upsertError } = await supabase
        .from("analyzed_contents")
        .upsert(recordsToUpsert, {
          onConflict: "parsed_content_url", // 指定衝突檢查的欄位 (唯一約束)
          ignoreDuplicates: true, // <<< 關鍵：設為 true 以忽略重複 >>>
          // 如果你想在衝突時更新某些欄位，可以使用 defaultToNext: true，但這裡我們只想忽略
        });
      // <<< 修改結束 >>>

      if (upsertError) {
        totalAnalysisQueueErrors++;
        console.error(
          `[${JOB_NAME}] Error upserting new URLs into analyzed_contents: ${upsertError.message}`
        );
        // 根據嚴重性考慮是否需要標記 Job 失敗
      } else {
        // 記錄嘗試加入的數量，實際成功插入的數量可能因重複而被忽略
        newUrlsAddedToAnalysisQueue = uniqueUrlsToAdd.size;
        console.log(
          `[${JOB_NAME}] Attempted to upsert ${newUrlsAddedToAnalysisQueue} URLs into analysis queue (duplicates ignored).`
        );
      }
    } else {
      console.log(
        `[${JOB_NAME}] No new unique content URLs found in this run.`
      );
    }

    // --- 6. 更新 job_state ---
    if (latestSuccessfullyProcessedGazetteId) {
      console.log(
        `[${JOB_NAME}] Updating job state. Setting last_processed_id to: ${latestSuccessfullyProcessedGazetteId}`
      );
      const { error: updateStateError } = await supabase
        .from("job_state")
        .upsert(
          {
            job_name: JOB_NAME,
            last_processed_id: latestSuccessfullyProcessedGazetteId,
            last_run_at: new Date().toISOString(),
          },
          { onConflict: "job_name" }
        );
      if (updateStateError) {
        console.error(
          `[${JOB_NAME}] CRITICAL: Error updating job state: ${updateStateError.message}`
        );
      } else {
        console.log(`[${JOB_NAME}] Job state updated successfully.`);
      }
    } else if (processedNewGazetteCount > 0) {
      // 有處理公報但沒有任何一個完全成功
      console.log(
        `[${JOB_NAME}] No gazette processed fully without errors. Updating last run time only.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    } else {
      // 沒有新公報處理
      console.log(
        `[${JOB_NAME}] No new gazettes processed. Updating last run time.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Uncaught CRITICAL ERROR in main handler:`,
      error
    );
    // 在嚴重錯誤時不更新 job_state，以便下次重試
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- 7. 記錄最終摘要並返回成功響應 ---
  const duration = (Date.now() - startTime) / 1000;
  const summary = `Run finished. Processed ${processedNewGazetteCount} new gazettes. Fetched ${fetchedNewAgendaCount} agendas. Saved ${totalAgendasSaved} agenda metadata records. Added ${newUrlsAddedToAnalysisQueue} unique URLs to queue (Errors: ${totalAnalysisQueueErrors}). Agenda fetch errors: ${totalAgendaFetchErrors}, Save errors: ${totalAgendaSaveErrors}. Duration: ${duration.toFixed(
    2
  )}s. Last fully successful Gazette ID updated to: ${
    latestSuccessfullyProcessedGazetteId || "None"
  }.`;
  console.log(`[${JOB_NAME}] ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
