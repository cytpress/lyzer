import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  Gazette,
  GazetteAgenda,
  JOB_NAME_FETCHER, // 從 _shared 導入
} from "../_shared/utils.ts";
import {
  fetchRecentGazettesFromAPI,
  fetchAllAgendasForGazetteFromAPI,
} from "./gazetteFetcher.ts";
import {
  upsertGazetteRecordToDB,
  upsertAgendaRecordToDB,
  addUrlsToAnalysisQueueDB,
  updateJobStateInDB,
} from "./databaseUpdater.ts";

// --- Configuration (導出給其他模塊用) ---
// JOB_NAME_FETCHER 已從 _shared/utils.ts 導入
export const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
export const GAZETTES_PER_PAGE = 100;
export const AGENDAS_PER_PAGE = 100;

serve(async (_req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteIdThisRun: string | null = null;
  let newUrlsAddedToQueueCount = 0;
  let totalAgendasSavedThisRun = 0;
  let overallAgendaFetchErrors = 0;
  let overallAgendaSaveErrors = 0;
  let overallAnalysisQueueErrors = 0;
  const errorsThisRun: string[] = [];

  const supabase = getSupabaseClient();
  console.log(`[${JOB_NAME_FETCHER}] Function execution started.`);

  try {
    console.log(`[${JOB_NAME_FETCHER}] Fetching last processed ID...`);
    const { data: jobState, error: stateError } = await supabase
      .from("job_state")
      .select("last_processed_id")
      .eq("job_name", JOB_NAME_FETCHER)
      .maybeSingle();

    if (stateError) {
      console.warn(
        `[${JOB_NAME_FETCHER}] Warn: Error fetching job state: ${stateError.message}. Proceeding assuming first run.`
      );
      errorsThisRun.push(`Error fetching job state: ${stateError.message}`);
    }
    const lastProcessedIdFromDB = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME_FETCHER}] Last processed Gazette ID from DB: ${
        lastProcessedIdFromDB || "None"
      }`
    );

    const fetchedGazettesFromAPI = await fetchRecentGazettesFromAPI();

    const newGazettesToProcess: Gazette[] = [];
    if (fetchedGazettesFromAPI.length > 0) {
      for (const gazette of fetchedGazettesFromAPI) {
        if (
          !gazette ||
          typeof gazette.公報編號 !== "string" ||
          String(gazette.公報編號).trim() === ""
        ) {
          console.warn(
            `[${JOB_NAME_FETCHER}] Main loop: Skipping a gazette due to invalid '公報編號'. API Object: ${JSON.stringify(
              gazette
            )}`
          );
          continue;
        }
        if (
          lastProcessedIdFromDB &&
          gazette.公報編號 === lastProcessedIdFromDB
        ) {
          console.log(
            `[${JOB_NAME_FETCHER}] Reached last processed ID (${lastProcessedIdFromDB}). Stopping gazette check.`
          );
          break;
        }
        newGazettesToProcess.push(gazette);
      }
    }
    newGazettesToProcess.reverse();
    console.log(
      `[${JOB_NAME_FETCHER}] Found ${newGazettesToProcess.length} new gazettes to process.`
    );

    if (newGazettesToProcess.length === 0) {
      await updateJobStateInDB(
        supabase,
        JOB_NAME_FETCHER,
        lastProcessedIdFromDB, // 即使沒有新公報，也用舊的 ID 更新 last_run_at
        "No new gazettes found."
      );
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const uniqueUrlsToAdd = new Set<string>();

    for (const gazetteFromApi of newGazettesToProcess) {
      const currentGazetteIdFromApi = String(gazetteFromApi.公報編號).trim();

      console.log(
        `\n[${JOB_NAME_FETCHER}] Processing NEW Gazette ID: "${currentGazetteIdFromApi}" (Publish Date: ${gazetteFromApi.發布日期})`
      );
      processedNewGazetteCount++;
      let currentGazetteHasErrors = false;

      const upsertGazetteRes = await upsertGazetteRecordToDB(
        supabase,
        gazetteFromApi
      );
      if (!upsertGazetteRes.success || !upsertGazetteRes.gazetteId) {
        const errorMsg = `Error upserting gazette (API ID: "${currentGazetteIdFromApi}"): ${
          upsertGazetteRes.error ||
          "Unknown error or missing gazetteId after upsert"
        }`;
        console.error(`[${JOB_NAME_FETCHER}] ${errorMsg}`);
        errorsThisRun.push(errorMsg);
        currentGazetteHasErrors = true;
        continue; // 跳過此公報的後續處理
      }
      const confirmedGazetteId = upsertGazetteRes.gazetteId; // 這是數據庫中實際的 gazette_id

      const { agendas: fetchedApiAgendas, errorOccurred: agendaFetchErr } =
        await fetchAllAgendasForGazetteFromAPI(confirmedGazetteId); // 使用確認的 ID
      if (agendaFetchErr) {
        overallAgendaFetchErrors++;
        currentGazetteHasErrors = true;
        const errorMsg = `Failed to fetch all agendas for gazette ${confirmedGazetteId}`;
        console.warn(`[${JOB_NAME_FETCHER}] ${errorMsg}`);
        errorsThisRun.push(errorMsg);
        // 即使抓取議程失敗，公報本身已存儲，所以不 continue，但標記錯誤
      }

      let agendasSavedThisGazette = 0;
      if (fetchedApiAgendas && fetchedApiAgendas.length > 0) {
        for (const apiAgenda of fetchedApiAgendas) {
          fetchedNewAgendaCount++;
          const upsertAgendaRes = await upsertAgendaRecordToDB(
            supabase,
            apiAgenda,
            confirmedGazetteId // 使用確認的父級 ID
          );
          if (!upsertAgendaRes.success) {
            overallAgendaSaveErrors++;
            currentGazetteHasErrors = true;
            const errorMsg = `Error upserting agenda ${
              apiAgenda.公報議程編號 || "UNKNOWN_AGENDA_ID"
            } for gazette ${confirmedGazetteId}: ${upsertAgendaRes.error}`;
            console.warn(`[${JOB_NAME_FETCHER}] ${errorMsg}`);
            errorsThisRun.push(errorMsg);
          } else {
            agendasSavedThisGazette++;
            totalAgendasSavedThisRun++;
          }
          if (upsertAgendaRes.parsedContentUrl) {
            uniqueUrlsToAdd.add(upsertAgendaRes.parsedContentUrl);
          }
        }
      }
      console.log(
        `[${JOB_NAME_FETCHER}] Finished processing agenda metadata for ${confirmedGazetteId}. Saved ${agendasSavedThisGazette}/${
          fetchedApiAgendas?.length || 0
        } records.`
      );

      if (!currentGazetteHasErrors) {
        latestSuccessfullyProcessedGazetteIdThisRun = confirmedGazetteId;
        console.log(
          `[${JOB_NAME_FETCHER}] Successfully processed all parts for Gazette ID: ${confirmedGazetteId}.`
        );
      } else {
        console.warn(
          `[${JOB_NAME_FETCHER}] Gazette ${confirmedGazetteId} encountered errors. Not marking as latest success for this run.`
        );
      }
    }

    const queueResult = await addUrlsToAnalysisQueueDB(
      supabase,
      uniqueUrlsToAdd
    );
    newUrlsAddedToQueueCount = queueResult.count;
    if (queueResult.error) {
      overallAnalysisQueueErrors++;
      errorsThisRun.push(
        `Error adding to analysis queue: ${queueResult.error}`
      );
    }

    const finalLastProcessedIdToSave =
      latestSuccessfullyProcessedGazetteIdThisRun ?? lastProcessedIdFromDB; // 如果本輪所有新公報都失敗，則保留舊的ID
    let finalJobNotes =
      errorsThisRun.length > 0
        ? `Run completed with ${errorsThisRun.length} errors (see function logs).`
        : "Run completed successfully.";
    if (
      overallAgendaFetchErrors > 0 ||
      overallAgendaSaveErrors > 0 ||
      overallAnalysisQueueErrors > 0
    ) {
      finalJobNotes += ` Data processing issues: FetchAgendaErrs=${overallAgendaFetchErrors}, SaveAgendaErrs=${overallAgendaSaveErrors}, QueueAddErrs=${overallAnalysisQueueErrors}.`;
    }
    await updateJobStateInDB(
      supabase,
      JOB_NAME_FETCHER,
      finalLastProcessedIdToSave, // 可以是 null 如果是首次運行且沒有成功處理任何記錄
      finalJobNotes
    );
  } catch (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Uncaught CRITICAL ERROR in main handler:`,
      error,
      error.stack
    );
    errorsThisRun.push(`Critical unhandled error: ${error.message}`);
    // 發生嚴重錯誤時，不更新 last_processed_id (傳入 undefined)
    await updateJobStateInDB(
      supabase,
      JOB_NAME_FETCHER,
      undefined, // 保持上一次的 last_processed_id
      `Run FAILED with critical error: ${
        error.message
      }. Errors: ${errorsThisRun.join("; ")}`
    );
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
  let summary = `Run finished. Processed ${processedNewGazetteCount} new gazettes. Fetched ${fetchedNewAgendaCount} agendas. Saved ${totalAgendasSavedThisRun} agenda records. Added/Ensured ${newUrlsAddedToQueueCount} unique URLs in queue. `;
  if (errorsThisRun.length > 0) {
    summary += `Encountered system errors: ${errorsThisRun.length}. `;
  } else if (
    overallAgendaFetchErrors > 0 ||
    overallAgendaSaveErrors > 0 ||
    overallAnalysisQueueErrors > 0
  ) {
    summary += `Encountered data processing issues (Fetch: ${overallAgendaFetchErrors}, Save: ${overallAgendaSaveErrors}, Queue: ${overallAnalysisQueueErrors}). `;
  } else {
    summary += "No errors encountered. ";
  }
  const finalLPIForSummary =
    latestSuccessfullyProcessedGazetteIdThisRun ??
    "None this run (or kept previous if all new failed)";
  summary += `Duration: ${duration.toFixed(
    2
  )}s. Last fully successful Gazette ID processed in this run: ${finalLPIForSummary}.`;
  console.log(`[${JOB_NAME_FETCHER}] ${summary}`);

  return new Response(
    JSON.stringify({ success: true, message: summary, errors: errorsThisRun }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
