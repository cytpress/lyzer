// supabase/functions/fetch-new-gazettes/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  // isValidDateString, // isValidDateString 的使用已移至 databaseUpdater.ts
  Gazette,
  GazetteAgenda, // 需要此類型，因為 fetchAllAgendasForGazetteFromAPI 返回 GazetteAgenda[]
  // GazetteRecord, // GazetteRecord 的構造已移至 databaseUpdater.ts
  // GazetteAgendaRecord, // 同上
} from "../_shared/utils.ts"; // <<< 路徑修正 >>>
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
export const JOB_NAME_FETCHER = "fetch-new-gazettes";
export const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
export const GAZETTES_PER_PAGE = 100; // 與你日誌一致
export const AGENDAS_PER_PAGE = 100;
// FETCH_DELAY_MS 和 LY_API_USER_AGENT 從 utils.ts 導入並在 fetchWithRetry 中使用，index.ts 無需直接關心

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
        // 在 fetchRecentGazettesFromAPI 中已經有對 公報編號 的初步檢查和日誌
        // 這裡可以再做一次保險檢查，或者相信 fetcher 已經過濾
        if (
          !gazette ||
          typeof gazette.公報編號 !== "string" ||
          String(gazette.公報編號).trim() === ""
        ) {
          console.warn(
            `[${JOB_NAME_FETCHER}] Main loop: Skipping a gazette due to invalid '公報編號'.`
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
        lastProcessedIdFromDB,
        "No new gazettes found."
      );
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const uniqueUrlsToAdd = new Set<string>();

    for (const gazetteFromApi of newGazettesToProcess) {
      // gazetteFromApi 的類型是 Gazette
      const currentGazetteId = String(gazetteFromApi.公報編號).trim(); // 已在上一步檢查過，這裡再次 trim 以防萬一

      console.log(
        `\n[${JOB_NAME_FETCHER}] Processing NEW Gazette ID: "${currentGazetteId}" (Publish Date: ${gazetteFromApi.發布日期})`
      );
      processedNewGazetteCount++;
      let currentGazetteHasErrors = false;

      // 直接將從 API 獲取的 gazetteFromApi (Gazette 類型) 傳遞給處理函數
      const upsertGazetteRes = await upsertGazetteRecordToDB(
        supabase,
        gazetteFromApi
      );
      if (!upsertGazetteRes.success) {
        errorsThisRun.push(
          `Error upserting gazette "${
            upsertGazetteRes.gazetteId || "UNKNOWN_ID"
          }": ${upsertGazetteRes.error}`
        );
        currentGazetteHasErrors = true;
        continue;
      }
      // 確保 currentGazetteId 是從 upsertGazetteRes.gazetteId 獲取的已驗證 ID
      const confirmedGazetteId = upsertGazetteRes.gazetteId!;

      const { agendas: fetchedApiAgendas, errorOccurred: agendaFetchErr } =
        await fetchAllAgendasForGazetteFromAPI(confirmedGazetteId);
      if (agendaFetchErr) {
        overallAgendaFetchErrors++;
        currentGazetteHasErrors = true;
        errorsThisRun.push(
          `Failed to fetch all agendas for gazette ${confirmedGazetteId}`
        );
      }

      let agendasSavedThisGazette = 0;
      if (fetchedApiAgendas && fetchedApiAgendas.length > 0) {
        for (const apiAgenda of fetchedApiAgendas) {
          // apiAgenda 的類型是 GazetteAgenda
          fetchedNewAgendaCount++;
          // upsertAgendaRecordToDB 現在接收原始的 apiAgenda (GazetteAgenda 類型)
          const upsertAgendaRes = await upsertAgendaRecordToDB(
            supabase,
            apiAgenda,
            confirmedGazetteId
          );
          if (!upsertAgendaRes.success) {
            overallAgendaSaveErrors++;
            currentGazetteHasErrors = true;
            errorsThisRun.push(
              `Error upserting agenda ${apiAgenda.公報議程編號}: ${upsertAgendaRes.error}`
            );
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
      latestSuccessfullyProcessedGazetteIdThisRun ?? lastProcessedIdFromDB;
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
      finalLastProcessedIdToSave,
      finalJobNotes
    );
  } catch (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Uncaught CRITICAL ERROR in main handler:`,
      error,
      error.stack
    );
    errorsThisRun.push(`Critical unhandled error: ${error.message}`);
    await updateJobStateInDB(
      supabase,
      JOB_NAME_FETCHER,
      undefined,
      `Run FAILED with critical error: ${
        error.message
      }. Errors: ${errorsThisRun.join("; ")}`
    ); // undefined 表示不更新 last_processed_id
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
  // ... (summary 日誌和返回，與我上次提供的一致) ...
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
    "None (or kept previous if all new failed)";
  summary += `Duration: ${duration.toFixed(
    2
  )}s. Last fully successful Gazette ID processed in this run: ${finalLPIForSummary}.`;
  console.log(`[${JOB_NAME_FETCHER}] ${summary}`);

  return new Response(
    JSON.stringify({ success: true, message: summary, errors: errorsThisRun }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
