import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseClient,
  updateJobStateInDB, // Using shared utility
  JOB_NAME_FETCHER,
} from "../_shared/utils.ts";
import type { Gazette } from "../_shared/types/api.ts";
// Database types like GazetteRecord are now primarily used within databaseUpdater.ts
import {
  fetchRecentGazettesFromAPI,
  fetchAllAgendasForGazetteFromAPI,
} from "./gazetteFetcher.ts";
import {
  upsertGazetteRecordToDB,
  upsertAgendaRecordToDB,
  addUrlsToAnalysisQueueDB,
} from "./databaseUpdater.ts";

// --- Configuration for this specific function ---
export const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
export const GAZETTES_PER_PAGE = 100; // Number of gazettes to fetch per API call
export const AGENDAS_PER_PAGE = 100; // Number of agendas per gazette to fetch per API call

// --- Main Function Handler ---
// This Supabase Edge Function is responsible for fetching new gazette data.
serve(async (_req) => {
  const startTime = Date.now();
  // Counters and state for this execution run
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteIdThisRun: string | null = null;
  let newUrlsAddedToQueueCount = 0;
  let totalAgendasSavedThisRun = 0;
  let overallAgendaFetchErrors = 0;
  let overallAgendaSaveErrors = 0;
  let overallAnalysisQueueErrors = 0;
  const errorsThisRun: string[] = []; // Collects specific error messages

  const supabase = getSupabaseClient();
  console.log(`[${JOB_NAME_FETCHER}] Function execution started.`);

  try {
    // 1. Retrieve the ID of the last gazette processed in the previous successful run.
    console.log(
      `[${JOB_NAME_FETCHER}] Fetching last processed ID from job_state...`
    );
    let lastProcessedIdFromDB: string | null = null; // Initialize
    try {
      const { data: jobState, error: stateError } = await supabase
        .from("job_state")
        .select("last_processed_id")
        .eq("job_name", JOB_NAME_FETCHER)
        .maybeSingle();

      if (stateError) {
        console.warn(
          `[${JOB_NAME_FETCHER}] Warning: Error fetching job state: ${stateError.message}. Proceeding as if first run.`
        );
        errorsThisRun.push(`Error fetching job state: ${stateError.message}`);
      }
      lastProcessedIdFromDB = jobState?.last_processed_id || null;
      console.log(
        `[${JOB_NAME_FETCHER}] Last processed Gazette ID from DB: ${
          lastProcessedIdFromDB || "None (first run or cleared)"
        }`
      );
    } catch (e) {
      // Catch potential critical error during job state fetch
      console.error(
        `[${JOB_NAME_FETCHER}] CRITICAL error fetching job state: ${e.message}. Halting execution.`
      );
      throw e; // Re-throw to stop the function if this fails
    }

    // 2. Fetch the latest list of gazettes from the external API.
    const fetchedGazettesFromAPI = await fetchRecentGazettesFromAPI();

    // 3. Filter out gazettes already processed.
    const newGazettesToProcess: Gazette[] = [];
    if (fetchedGazettesFromAPI.length > 0) {
      for (const gazette of fetchedGazettesFromAPI) {
        // Basic validation of API data
        if (
          !gazette ||
          typeof gazette.公報編號 !== "string" ||
          String(gazette.公報編號).trim() === ""
        ) {
          console.warn(
            `[${JOB_NAME_FETCHER}] Main loop: Skipping a gazette due to invalid '公報編號' (Gazette ID). API Object: ${JSON.stringify(
              gazette
            )}`
          );
          continue;
        }
        const currentApiGazetteId = String(gazette.公報編號).trim();
        // Stop if we reach the last known processed ID
        if (
          lastProcessedIdFromDB &&
          currentApiGazetteId === lastProcessedIdFromDB
        ) {
          console.log(
            `[${JOB_NAME_FETCHER}] Reached last processed ID ('${lastProcessedIdFromDB}'). Stopping gazette check.`
          );
          break;
        }
        newGazettesToProcess.push(gazette);
      }
    }
    newGazettesToProcess.reverse(); // Process in chronological order (oldest new first)
    console.log(
      `[${JOB_NAME_FETCHER}] Found ${newGazettesToProcess.length} new gazette(s) to process.`
    );

    // If no new gazettes and no errors so far, update job state and exit.
    if (newGazettesToProcess.length === 0 && errorsThisRun.length === 0) {
      await updateJobStateInDB(
        supabase,
        JOB_NAME_FETCHER,
        lastProcessedIdFromDB, // Update last_run_at with the same last_processed_id
        "No new gazettes found."
      );
      console.log(
        `[${JOB_NAME_FETCHER}] No new gazettes found. Job state updated. Exiting.`
      );
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else if (newGazettesToProcess.length === 0 && errorsThisRun.length > 0) {
      // If no new gazettes but errors occurred (e.g., fetching job state), still proceed to final state update.
      console.log(
        `[${JOB_NAME_FETCHER}] No new gazettes found, but errors occurred during setup. Proceeding to final job state update.`
      );
    }

    const uniqueUrlsToAdd = new Set<string>(); // Collect unique content URLs for the analysis queue

    // 4. Process each new gazette.
    for (const gazetteFromApi of newGazettesToProcess) {
      const currentGazetteIdFromApi = String(gazetteFromApi.公報編號).trim();
      console.log(
        `\n[${JOB_NAME_FETCHER}] Processing NEW Gazette ID: "${currentGazetteIdFromApi}" (Published: ${gazetteFromApi.發布日期})`
      );
      processedNewGazetteCount++;
      let currentGazetteHasErrors = false; // Track errors for this specific gazette

      // 4a. Save gazette metadata to DB.
      const upsertGazetteRes = await upsertGazetteRecordToDB(
        supabase,
        gazetteFromApi
      );
      if (!upsertGazetteRes.success || !upsertGazetteRes.gazetteId) {
        const errorMsg = `Error upserting gazette record (API ID: "${currentGazetteIdFromApi}"): ${
          upsertGazetteRes.error ||
          "Unknown error or missing gazetteId after upsert"
        }`;
        console.error(`[${JOB_NAME_FETCHER}] ${errorMsg}`);
        errorsThisRun.push(errorMsg);
        currentGazetteHasErrors = true;
        continue; // Skip to next gazette if saving this one fails critically
      }
      const confirmedGazetteId = upsertGazetteRes.gazetteId; // Use ID confirmed by DB

      // 4b. Fetch all agendas for this gazette.
      const { agendas: fetchedApiAgendas, errorOccurred: agendaFetchErr } =
        await fetchAllAgendasForGazetteFromAPI(confirmedGazetteId);
      if (agendaFetchErr) {
        overallAgendaFetchErrors++;
        currentGazetteHasErrors = true;
        const errorMsg = `Failed to fetch all agendas for gazette ID ${confirmedGazetteId}.`;
        console.warn(`[${JOB_NAME_FETCHER}] ${errorMsg}`);
        errorsThisRun.push(errorMsg);
        // Continue processing any agendas that might have been fetched despite partial failure
      }

      // 4c. Save agenda metadata and collect content URLs.
      let agendasSavedThisGazette = 0;
      if (fetchedApiAgendas && fetchedApiAgendas.length > 0) {
        fetchedNewAgendaCount += fetchedApiAgendas.length;
        for (const apiAgenda of fetchedApiAgendas) {
          const upsertAgendaRes = await upsertAgendaRecordToDB(
            supabase,
            apiAgenda,
            confirmedGazetteId
          );
          if (!upsertAgendaRes.success) {
            overallAgendaSaveErrors++;
            currentGazetteHasErrors = true;
            const errorMsg = `Error upserting agenda '${
              apiAgenda.公報議程編號 || "UNKNOWN_AGENDA_ID"
            }' for gazette ${confirmedGazetteId}: ${upsertAgendaRes.error}`;
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
        } agenda record(s).`
      );

      // 4d. If this gazette was processed without any errors, update the pointer for this run.
      if (!currentGazetteHasErrors) {
        latestSuccessfullyProcessedGazetteIdThisRun = confirmedGazetteId;
        console.log(
          `[${JOB_NAME_FETCHER}] Gazette ID ${confirmedGazetteId} and its agendas processed successfully (or with non-critical errors).`
        );
      } else {
        console.warn(
          `[${JOB_NAME_FETCHER}] Gazette ID ${confirmedGazetteId} encountered errors. Not marking as latest fully successful ID for this run.`
        );
      }
    } // End loop through newGazettesToProcess

    // 5. Add collected unique content URLs to the analysis queue.
    if (uniqueUrlsToAdd.size > 0) {
      console.log(
        `[${JOB_NAME_FETCHER}] Adding ${uniqueUrlsToAdd.size} unique content URL(s) to the analysis queue...`
      );
      const queueResult = await addUrlsToAnalysisQueueDB(
        supabase,
        uniqueUrlsToAdd
      );
      newUrlsAddedToQueueCount = queueResult.count; // Number of *newly* added URLs
      if (queueResult.error) {
        overallAnalysisQueueErrors++;
        errorsThisRun.push(
          `Error adding URLs to analysis queue: ${queueResult.error}`
        );
      }
      console.log(
        `[${JOB_NAME_FETCHER}] Finished adding URLs to queue. ${newUrlsAddedToQueueCount} new URL(s) inserted.`
      );
    } else {
      console.log(
        `[${JOB_NAME_FETCHER}] No new unique content URLs found to add to the analysis queue in this run.`
      );
    }

    // 6. Update job state for this run.
    // If `latestSuccessfullyProcessedGazetteIdThisRun` is set, use it. Otherwise, use `lastProcessedIdFromDB`.
    const finalLastProcessedIdToSave =
      latestSuccessfullyProcessedGazetteIdThisRun ?? lastProcessedIdFromDB;
    let finalJobNotes =
      errorsThisRun.length > 0
        ? `Run completed with ${errorsThisRun.length} error(s).`
        : "Run completed successfully.";
    if (
      overallAgendaFetchErrors > 0 ||
      overallAgendaSaveErrors > 0 ||
      overallAnalysisQueueErrors > 0
    ) {
      finalJobNotes += ` Data processing issues: FetchAgendaErrs=${overallAgendaFetchErrors}, SaveAgendaErrs=${overallAgendaSaveErrors}, QueueAddErrs=${overallAnalysisQueueErrors}.`;
    }
    if (processedNewGazetteCount === 0 && errorsThisRun.length === 0) {
      // Specific note if no new work was done
      finalJobNotes = "No new gazettes found.";
    }
    await updateJobStateInDB(
      supabase,
      JOB_NAME_FETCHER,
      finalLastProcessedIdToSave,
      finalJobNotes
    );
  } catch (error) {
    // Catch critical unhandled errors from the main try block
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_FETCHER}] CRITICAL: Unhandled error in main handler:`,
      error,
      error instanceof Error ? error.stack : undefined
    );
    errorsThisRun.push(`Critical unhandled error: ${errorMsg}`);
    // Attempt to update job state with failure, but don't change last_processed_id
    try {
      await updateJobStateInDB(
        supabase,
        JOB_NAME_FETCHER,
        undefined,
        `Run FAILED with critical error: ${errorMsg}. Errors: ${errorsThisRun.length}`
      );
    } catch (stateUpdateError) {
      console.error(
        `[${JOB_NAME_FETCHER}] Also failed to update job state after critical error: ${stateUpdateError.message}`
      );
    }
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${errorMsg}`,
        errors: errorsThisRun,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Generate final summary for this run ---
  const duration = (Date.now() - startTime) / 1000;
  let summaryMessage = `Run finished. Processed ${processedNewGazetteCount} new gazette(s). Fetched ${fetchedNewAgendaCount} agenda(s). Saved ${totalAgendasSavedThisRun} agenda record(s). Added/Ensured ${newUrlsAddedToQueueCount} URL(s) in analysis queue.`;
  if (errorsThisRun.length > 0) {
    summaryMessage += ` Encountered ${errorsThisRun.length} system error(s).`;
  } else if (
    overallAgendaFetchErrors > 0 ||
    overallAgendaSaveErrors > 0 ||
    overallAnalysisQueueErrors > 0
  ) {
    summaryMessage += ` Encountered data processing issues (Fetch: ${overallAgendaFetchErrors}, Save: ${overallAgendaSaveErrors}, Queue: ${overallAnalysisQueueErrors}).`;
  } else if (processedNewGazetteCount === 0) {
    summaryMessage = "Run finished. No new gazettes found to process.";
  } else {
    summaryMessage += " No errors encountered.";
  }
  const finalLPIForSummary =
    latestSuccessfullyProcessedGazetteIdThisRun ??
    "None this run (or kept previous)";
  summaryMessage += ` Duration: ${duration.toFixed(
    2
  )}s. Last successfully processed Gazette ID this run: ${finalLPIForSummary}.`;

  console.log(`[${JOB_NAME_FETCHER}] ${summaryMessage}`);

  return new Response(
    JSON.stringify({
      success: errorsThisRun.length === 0, // Overall success of the run
      message: summaryMessage,
      details: {
        processedGazettes: processedNewGazetteCount,
        fetchedAgendas: fetchedNewAgendaCount,
        savedAgendas: totalAgendasSavedThisRun,
        urlsAddedToQueue: newUrlsAddedToQueueCount, // Changed key for clarity
        errorsInAgendaFetching: overallAgendaFetchErrors, // Changed key for clarity
        errorsInAgendaSaving: overallAgendaSaveErrors, // Changed key for clarity
        errorsInQueueAdding: overallAnalysisQueueErrors, // Changed key for clarity
        lastSuccessfullyProcessedIdThisRun:
          latestSuccessfullyProcessedGazetteIdThisRun, // Changed key for clarity
      },
      errors: errorsThisRun,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
