// Example path: supabase/functions/fetch-new-gazettes/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  fetchWithRetry,
  isValidDateString,
  Gazette,
  GazetteApiResponse,
  GazetteAgenda,
  AgendaApiResponse,
  GazetteRecord,
  GazetteAgendaRecord, // Assumes this type in utils.ts includes official_page_url, official_pdf_url
  AnalysisErrorJson, // Import the error structure type
  FETCH_DELAY_MS,
  getSupabaseClient,
} from "../_shared/utils.ts"; // Make sure path to utils.ts is correct

// --- Configuration ---
const JOB_NAME = "fetch-new-gazettes";
const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
// LY_AGENDA_API_URL_BASE is the same as gazette base for specific gazette lookup
const GAZETTES_PER_PAGE = 50; // Number of gazettes to fetch per API call initially
const AGENDAS_PER_PAGE = 100; // Number of agendas to fetch per page for a gazette

serve(async (req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteId: string | null = null;
  let skippedNoTxtUrlCount = 0;
  let totalAgendasSaved = 0;
  let totalAgendaFetchErrors = 0; // Track errors during agenda fetching
  let totalAgendaSaveErrors = 0; // Track errors during agenda saving

  // Get Supabase client instance
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
      // Log warning but proceed, assuming first run or recoverable state error
      console.error(
        `[${JOB_NAME}] Warning: Error fetching job state: ${stateError.message}. Proceeding assuming first run or last ID unknown.`
      );
    }
    const lastProcessedId = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME}] Last successfully processed Gazette ID from DB: ${
        lastProcessedId || "None (First Run?)"
      }`
    );

    // 2. Fetch the list of recent gazettes (only first page initially)
    const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
    console.log(
      `[${JOB_NAME}] Fetching recent gazettes list: ${gazetteListUrl}`
    );
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // API delay
    const gazetteApiResponse = await fetchWithRetry(
      gazetteListUrl,
      undefined,
      3, // Retries
      JOB_NAME
    );
    const gazetteApiData: GazetteApiResponse = await gazetteApiResponse.json();
    console.log(
      `[${JOB_NAME}] Received ${
        gazetteApiData.gazettes?.length || 0
      } gazettes from API (Page 1).`
    );

    // 3. Filter out already processed gazettes based on lastProcessedId
    const newGazettesToProcess: Gazette[] = [];
    if (gazetteApiData.gazettes?.length > 0) {
      for (const gazette of gazetteApiData.gazettes) {
        // Stop adding if we encounter the last processed gazette
        if (lastProcessedId && gazette.公報編號 === lastProcessedId) {
          console.log(
            `[${JOB_NAME}] Reached last processed ID (${lastProcessedId}). Stopping gazette check.`
          );
          break;
        }
        newGazettesToProcess.push(gazette);
      }
    }

    // Reverse the list to process from the oldest new gazette to the newest
    newGazettesToProcess.reverse();
    console.log(
      `[${JOB_NAME}] Found ${newGazettesToProcess.length} new gazettes to process since last run.`
    );

    // Exit early if no new gazettes need processing
    if (newGazettesToProcess.length === 0) {
      console.log(
        `[${JOB_NAME}] No new gazettes found. Updating run time and exiting.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME); // Only update run time
      return new Response(
        JSON.stringify({ success: true, message: "No new gazettes found." }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 4. Process each new gazette sequentially
    for (const gazette of newGazettesToProcess) {
      const currentGazetteId = gazette.公報編號;
      console.log(
        `\n[${JOB_NAME}] Processing NEW Gazette ID: ${currentGazetteId} (Publish Date: ${gazette.發布日期})`
      );
      processedNewGazetteCount++;
      let gazetteProcessingErrorOccurred = false; // Flag for errors within this gazette's processing

      // 4.1 Upsert gazette metadata into the 'gazettes' table
      const gazetteRecord: GazetteRecord = {
        gazette_id: currentGazetteId,
        volume: gazette.卷,
        issue: gazette.期,
        booklet: gazette.冊別,
        publish_date: isValidDateString(gazette.發布日期)
          ? gazette.發布日期
          : null,
        // fetched_at is handled by DB default
      };
      const { error: gazetteUpsertError } = await supabase
        .from("gazettes")
        .upsert(gazetteRecord, { onConflict: "gazette_id" });

      if (gazetteUpsertError) {
        console.error(
          `[${JOB_NAME}] Error upserting gazette record ${currentGazetteId}: ${gazetteUpsertError.message}. Skipping its agendas.`
        );
        gazetteProcessingErrorOccurred = true;
        continue; // Skip to the next gazette if saving the gazette itself fails
      }
      console.log(
        `[${JOB_NAME}] Upserted gazette record for ${currentGazetteId}.`
      );

      // 4.2 Fetch ALL agendas for this specific gazette, handling pagination
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
            totalPages === 1 && currentPage === 1 ? "?" : totalPages // Show '?' for total pages initially
          } from: ${agendaApiUrl}`
        );

        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // API delay

        try {
          const agendaResponse = await fetchWithRetry(
            agendaApiUrl,
            undefined,
            3, // Retries
            JOB_NAME
          );
          const agendaData: AgendaApiResponse = await agendaResponse.json();

          // Add fetched agendas to the list
          if (agendaData.gazetteagendas?.length > 0) {
            allAgendasForThisGazette.push(...agendaData.gazetteagendas);
          } else if (currentPage === 1) {
            // Only log "No agendas found" if it's the first page and it's empty
            console.log(
              `[${JOB_NAME}] No agendas listed in API response for ${currentGazetteId}.`
            );
          }

          // Update total pages based on the first page's response
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
              currentPage // Log the page number that failed
            } for ${currentGazetteId}: ${
              fetchError.message
            }. Stopping agenda fetch for this gazette.`
          );
          totalAgendaFetchErrors++;
          agendaFetchFailed = true; // Mark that fetching was incomplete
          gazetteProcessingErrorOccurred = true;
          break; // Exit the do-while loop for this gazette's agendas
        }
      } while (currentPage <= totalPages);

      if (agendaFetchFailed) {
        console.warn(
          `[${JOB_NAME}] Agenda fetching may be incomplete for ${currentGazetteId}. Only ${allAgendasForThisGazette.length} agendas were successfully fetched before failure.`
        );
        // Decide policy: Should we still try to save the partially fetched agendas? Yes, let's try.
      } else {
        console.log(
          `[${JOB_NAME}] Successfully fetched all ${allAgendasForThisGazette.length} listed agendas for ${currentGazetteId}.`
        );
      }

      // 4.3 Process and upsert each fetched agenda into 'gazette_agendas' table
      let agendasSavedForThisGazette = 0;
      for (const agenda of allAgendasForThisGazette) {
        fetchedNewAgendaCount++; // Count every agenda fetched, regardless of save success
        const agendaId = agenda.公報議程編號;

        // Find the .txt URL needed for AI analysis
        const txtUrlObj = agenda.處理後公報網址?.find((u) => u.type === "txt");
        const txtUrl = txtUrlObj?.url || null;

        // Determine initial analysis status and result based on txt URL presence
        let initialStatus: "pending" | "failed" = "failed";
        // Use the AnalysisErrorJson structure for failures recorded here
        let analysisResultValue: AnalysisErrorJson | null = null;

        if (txtUrl) {
          initialStatus = "pending"; // Ready for the analysis job
          analysisResultValue = null; // Analysis result is null until processed
        } else {
          // If no txt URL, mark as failed immediately and store an error object
          skippedNoTxtUrlCount++;
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: No 'txt' URL found in 處理後公報網址. Status set to 'failed'.`
          );
          initialStatus = "failed";
          analysisResultValue = {
            // Store structured error
            error: "Missing Content URL",
            details: `No 'txt' type URL found in API response for Agenda ID: ${agendaId}`,
          };
        }

        // Validate meeting dates (ensure they are YYYY-MM-DD format)
        const validMeetingDates =
          agenda.會議日期?.filter(isValidDateString) || null;
        if (
          agenda.會議日期 && // Check if original array existed
          (!validMeetingDates ||
            validMeetingDates.length !== agenda.會議日期.length) // Check if filtering occurred
        ) {
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: Filtered potentially invalid meeting dates. Original: ${JSON.stringify(
              agenda.會議日期
            )}, Validated: ${JSON.stringify(validMeetingDates)}`
          );
        }

        // Create the record object for the database, including new URL fields
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
          parsed_content_url: txtUrl, // URL for the analysis job
          official_page_url: agenda.公報網網址 ?? null, // <<< ADDED >>> Official HTML page URL
          official_pdf_url: agenda.公報完整PDF網址 ?? null, // <<< ADDED >>> Official PDF URL
          analysis_status: initialStatus,
          analysis_result: analysisResultValue, // Store null (if pending) or AnalysisErrorJson (if failed here)
          analyzed_at: null, // Will be set by the analysis job later
          // fetched_at and updated_at are handled by DB defaults/triggers
        };

        // Upsert the agenda record into the database
        const { error: agendaUpsertError } = await supabase
          .from("gazette_agendas")
          .upsert(agendaRecord, { onConflict: "agenda_id" });

        if (agendaUpsertError) {
          totalAgendaSaveErrors++;
          gazetteProcessingErrorOccurred = true; // Mark error for this gazette
          console.error(
            `[${JOB_NAME}] Error upserting agenda ${agendaId}: ${agendaUpsertError.message}`
          );
          // Consider if one failed save should stop the whole process? For robustness, maybe just log and continue.
        } else {
          agendasSavedForThisGazette++;
          totalAgendasSaved++; // Increment total successful saves
        }
      } // End loop for processing agendas of the current gazette

      console.log(
        `[${JOB_NAME}] Finished processing agendas for gazette ${currentGazetteId}. Saved ${agendasSavedForThisGazette} / ${allAgendasForThisGazette.length} fetched agenda records.`
      );

      // Only mark this gazette ID as successfully processed if NO errors occurred during its processing
      // (including fetching *all* its agendas and saving them without error)
      if (!gazetteProcessingErrorOccurred) {
        latestSuccessfullyProcessedGazetteId = currentGazetteId;
        console.log(
          `[${JOB_NAME}] Successfully processed all parts for Gazette ID: ${currentGazetteId}. Marked as latest success.`
        );
      } else {
        console.warn(
          `[${JOB_NAME}] Gazette ${currentGazetteId} encountered errors during processing. It will NOT be marked as the latest successfully processed ID.`
        );
        // The job will retry processing this gazette (and subsequent ones) in the next run
        // because last_processed_id won't be updated to this ID.
      }
    } // End loop for processing new gazettes

    // 5. Update job state in the database
    // Only update last_processed_id if at least one gazette was fully processed without errors.
    if (latestSuccessfullyProcessedGazetteId) {
      console.log(
        `[${JOB_NAME}] Updating job state. Setting last_processed_id to: ${latestSuccessfullyProcessedGazetteId}`
      );
      const { error: updateStateError } = await supabase
        .from("job_state")
        .upsert(
          {
            job_name: JOB_NAME,
            last_processed_id: latestSuccessfullyProcessedGazetteId, // Update to the last fully successful one
            last_run_at: new Date().toISOString(), // Always update run time
          },
          { onConflict: "job_name" }
        );

      if (updateStateError) {
        console.error(
          `[${JOB_NAME}] CRITICAL: Error updating job state: ${updateStateError.message}`
        );
        // This is problematic, as the next run might re-process data.
      } else {
        console.log(`[${JOB_NAME}] Job state updated successfully.`);
      }
    } else if (processedNewGazetteCount > 0) {
      // If gazettes were processed but none completed fully without error
      console.log(
        `[${JOB_NAME}] Some gazettes processed but none completed fully without errors. Updating last run time only.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() }) // Only update run time
        .eq("job_name", JOB_NAME);
    } else {
      // If no new gazettes were found in the first place (already handled, but safe)
      console.log(
        `[${JOB_NAME}] No new gazettes needed processing. Updating last run time.`
      );
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() }) // Only update run time
        .eq("job_name", JOB_NAME);
    }
  } catch (error) {
    console.error(
      `[${JOB_NAME}] Uncaught CRITICAL ERROR in main handler:`,
      error
    );
    // Attempt to update last_run_at even on critical failure? Maybe not, to signal a problem.
    // await supabase.from("job_state").update({ last_run_at: new Date().toISOString() }).eq("job_name", JOB_NAME);

    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error during execution: ${error.message}`,
        stack: error.stack, // Include stack trace for easier debugging
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 6. Log final summary and return success response
  const duration = (Date.now() - startTime) / 1000;
  const summary = `Run finished. Processed ${processedNewGazetteCount} new gazettes. Fetched ${fetchedNewAgendaCount} total agendas. Saved ${totalAgendasSaved} agenda records successfully. Skipped ${skippedNoTxtUrlCount} agendas (no txt URL). Encountered ${totalAgendaFetchErrors} agenda fetch errors and ${totalAgendaSaveErrors} agenda save errors. Duration: ${duration.toFixed(
    2
  )}s. Last fully successful Gazette ID updated to: ${
    latestSuccessfullyProcessedGazetteId || "None" // Reflect the actual last successful ID
  }.`;
  console.log(`[${JOB_NAME}] ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
