import { serve } from "https://deno.land/std@0.177.0/http/server.ts"; 
import {
  fetchWithRetry,
  isValidDateString,
  Gazette,
  GazetteApiResponse,
  GazetteAgenda, 
  AgendaApiResponse,
  GazetteRecord,
  GazetteAgendaRecord, 
  FETCH_DELAY_MS,
  getSupabaseClient, 
} from "../_shared/utils.ts";

// --- Configuration ---
const JOB_NAME = "fetch-new-gazettes";
const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
const LY_AGENDA_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
const GAZETTES_PER_PAGE = 50;
const AGENDAS_PER_PAGE = 100;

serve(async (req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteId: string | null = null;
  let skippedNoTxtUrlCount = 0;
  let totalAgendasSaved = 0;

  // 使用 getSupabaseClient() 獲取客戶端實例
  const supabase = getSupabaseClient();
  console.log(`[${JOB_NAME}] Function execution started.`);

  try {
    // 1. Get the last processed gazette ID from job_state
    console.log(`[${JOB_NAME}] Fetching last processed ID from job_state...`);
    const { data: jobState, error: stateError } = await supabase
      .from("job_state")
      .select("last_processed_id")
      .eq("job_name", JOB_NAME)
      .maybeSingle();

    if (stateError) {
      // 考慮是否要 throw error 或只是記錄警告並繼續
      console.error(
        `[${JOB_NAME}] Warning: Error fetching job state: ${stateError.message}. Proceeding assuming first run.`
      );
      // throw new Error(`Error fetching job state: ${stateError.message}`);
    }
    const lastProcessedId = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME}] Last successfully processed Gazette ID: ${
        lastProcessedId || "None"
      }`
    );

    // 2. Fetch the list of recent gazettes
    const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
    console.log(`[${JOB_NAME}] Fetching recent gazettes: ${gazetteListUrl}`);
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
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
      } gazettes from API (Page 1).`
    );

    // 3. Filter out already processed gazettes
    const newGazettesToProcess: Gazette[] = [];
    if (gazetteApiData.gazettes?.length > 0) {
      for (const gazette of gazetteApiData.gazettes) {
        if (lastProcessedId && gazette.公報編號 === lastProcessedId) {
          console.log(
            `[${JOB_NAME}] Reached last processed ID (${lastProcessedId}). Stopping gazette check.`
          );
          break;
        }
        newGazettesToProcess.push(gazette);
      }
    }

    // Reverse to process from the oldest new one to the newest
    newGazettesToProcess.reverse();
    console.log(
      `[${JOB_NAME}] Found ${newGazettesToProcess.length} new gazettes to process.`
    );

    if (newGazettesToProcess.length === 0) {
      console.log(`[${JOB_NAME}] No new gazettes found. Exiting early.`);
      // 更新執行時間
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 4. Process each new gazette
    for (const gazette of newGazettesToProcess) {
      const currentGazetteId = gazette.公報編號;
      console.log(
        `\n[${JOB_NAME}] Processing NEW Gazette ID: ${currentGazetteId} (Publish Date: ${gazette.發布日期})`
      );
      processedNewGazetteCount++;

      // 4.1 Upsert gazette metadata
      const gazetteRecord: GazetteRecord = {
        gazette_id: currentGazetteId,
        volume: gazette.卷,
        issue: gazette.期,
        booklet: gazette.冊別,
        publish_date: isValidDateString(gazette.發布日期)
          ? gazette.發布日期
          : null,
      };
      const { error: gazetteUpsertError } = await supabase
        .from("gazettes")
        .upsert(gazetteRecord, { onConflict: "gazette_id" });

      if (gazetteUpsertError) {
        console.error(
          `[${JOB_NAME}] Error upserting gazette ${currentGazetteId}: ${gazetteUpsertError.message}. Skipping its agendas.`
        );
        continue;
      }
      console.log(
        `[${JOB_NAME}] Upserted gazette record for ${currentGazetteId}.`
      );

      // 4.2 Fetch all agendas for this gazette
      let currentPage = 1;
      let totalPages = 1;
      const allAgendasForThisGazette: GazetteAgenda[] = [];
      let agendaFetchFailed = false;

      console.log(
        `[${JOB_NAME}] Starting to fetch agendas for ${currentGazetteId}...`
      );
      do {
        const agendaApiUrl = `${LY_AGENDA_API_URL_BASE}/${currentGazetteId}/agendas?page=${currentPage}&per_page=${AGENDAS_PER_PAGE}`;
        console.log(
          `[${JOB_NAME}] Fetching agendas page ${currentPage}/${
            totalPages === 1 && currentPage === 1 ? "?" : totalPages
          } from: ${agendaApiUrl}`
        );

        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));

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
              `[${JOB_NAME}] No agendas found for ${currentGazetteId}.`
            );
          }

          if (currentPage === 1) {
            totalPages = agendaData.total_page || 1;
            console.log(
              `[${JOB_NAME}] Total pages of agendas for ${currentGazetteId}: ${totalPages}`
            );
          }

          currentPage++;
        } catch (fetchError) {
          console.error(
            `[${JOB_NAME}] Failed to fetch agendas page ${
              currentPage // Log the page that failed
            } for ${currentGazetteId}: ${
              fetchError.message
            }. Stopping agenda fetch for this gazette.`
          );
          agendaFetchFailed = true;
          break;
        }
      } while (currentPage <= totalPages);

      if (agendaFetchFailed) {
        console.warn(
          `[${JOB_NAME}] Agenda fetching failed or incomplete for ${currentGazetteId}. Only ${allAgendasForThisGazette.length} agendas were fetched.`
        );
      } else {
        console.log(
          `[${JOB_NAME}] Successfully fetched all ${allAgendasForThisGazette.length} agendas for ${currentGazetteId}.`
        );
      }

      // 4.3 Process and upsert each fetched agenda
      let agendasSavedForThisGazette = 0;
      for (const agenda of allAgendasForThisGazette) {
        fetchedNewAgendaCount++;
        const agendaId = agenda.公報議程編號;

        const txtUrlObj = agenda.處理後公報網址?.find((u) => u.type === "txt");
        const txtUrl = txtUrlObj?.url || null;

        let initialStatus: "pending" | "failed" = "failed";
        let analysisResultText: string | null = "No txt URL found";

        if (txtUrl) {
          initialStatus = "pending";
          analysisResultText = null;
        } else {
          skippedNoTxtUrlCount++;
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: No txt URL found. Status set to 'failed'.`
          );
        }

        const validMeetingDates =
          agenda.會議日期?.filter(isValidDateString) || null;
        if (
          agenda.會議日期 &&
          (!validMeetingDates ||
            validMeetingDates.length !== agenda.會議日期.length)
        ) {
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: Filtered invalid meeting dates. Original: ${JSON.stringify(
              agenda.會議日期
            )}, Valid: ${JSON.stringify(validMeetingDates)}`
          );
        }

        // --- 建立要寫入資料庫的 Record ---
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
          parsed_content_url: txtUrl,
          analysis_status: initialStatus,
          analysis_result: analysisResultText,
          analyzed_at: null,
          // fetched_at and updated_at are handled by DB defaults/triggers
        };
        // --- 結束建立 Record ---

        const { error: agendaUpsertError } = await supabase
          .from("gazette_agendas")
          .upsert(agendaRecord, { onConflict: "agenda_id" });

        if (agendaUpsertError) {
          console.error(
            `[${JOB_NAME}] Error upserting agenda ${agendaId}: ${agendaUpsertError.message}`
          );
        } else {
          agendasSavedForThisGazette++;
          totalAgendasSaved++;
        }
      } // End agenda loop

      console.log(
        `[${JOB_NAME}] Saved ${agendasSavedForThisGazette} / ${allAgendasForThisGazette.length} fetched agenda records for gazette ${currentGazetteId}.`
      );

      if (!agendaFetchFailed) {
        latestSuccessfullyProcessedGazetteId = currentGazetteId;
        console.log(
          `[${JOB_NAME}] Marked ${currentGazetteId} as the latest successfully processed gazette.`
        );
      } else {
        console.warn(
          `[${JOB_NAME}] Gazette ${currentGazetteId} was not marked as fully processed due to agenda fetch issues.`
        );
      }
    } // End new gazette loop

    // 5. Update job state
    if (latestSuccessfullyProcessedGazetteId) {
      console.log(
        `[${JOB_NAME}] Updating job state with latest successfully processed Gazette ID: ${latestSuccessfullyProcessedGazetteId}`
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
          `[${JOB_NAME}] Error updating job state: ${updateStateError.message}`
        );
      } else {
        console.log(`[${JOB_NAME}] Job state updated successfully.`);
      }
    } else if (processedNewGazetteCount > 0) {
      console.log(
        `[${JOB_NAME}] No new gazettes were fully processed successfully. Updating last run time only.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    } else {
      console.log(
        `[${JOB_NAME}] No new gazettes were processed. Job state ID remains unchanged. Updating last run time.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    // Consider updating last_run_at even on critical failure
    // await supabase.from("job_state").update({ last_run_at: new Date().toISOString() }).eq("job_name", JOB_NAME);

    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
        stack: error.stack, // Include stack trace for debugging
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 6. Log summary and return success
  const duration = (Date.now() - startTime) / 1000;
  const summary = `Run finished. Processed ${processedNewGazetteCount} new gazettes. Fetched ${fetchedNewAgendaCount} total agendas, saved ${totalAgendasSaved} records successfully. Skipped ${skippedNoTxtUrlCount} agendas due to missing txt URL. Duration: ${duration.toFixed(
    2
  )}s. Last successful ID updated to: ${
    latestSuccessfullyProcessedGazetteId || "None"
  }.`;
  console.log(`[${JOB_NAME}] ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
