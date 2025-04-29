import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2"; // Needs createClient import here as well
import {
  fetchWithRetry,
  isValidDateString,
  Gazette,
  GazetteApiResponse,
  GazetteAgenda,
  AgendaApiResponse,
  GazetteRecord,
  GazetteAgendaRecord,
  FETCH_DELAY_MS, // Use shared delay
} from "../_shared/utils.ts"; // Import necessary items from shared utils

// --- Configuration ---
const JOB_NAME = "fetch-new-gazettes";
const LY_GAZETTE_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes";
const LY_AGENDA_API_URL_BASE = "https://ly.govapi.tw/v2/gazettes"; // Base for /gazettes/{id}/agendas
const GAZETTES_PER_PAGE = 50; // How many gazettes to check per run
const AGENDAS_PER_PAGE = 100; // How many agendas per page when fetching

serve(async (req) => {
  const startTime = Date.now();
  let processedNewGazetteCount = 0;
  let fetchedNewAgendaCount = 0;
  let latestSuccessfullyProcessedGazetteId: string | null = null; // Track the *last ID whose agendas were fully processed*
  let skippedNoTxtUrlCount = 0;
  let totalAgendasSaved = 0;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
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
      throw new Error(`Error fetching job state: ${stateError.message}`);
    }
    const lastProcessedId = jobState?.last_processed_id || null;
    console.log(
      `[${JOB_NAME}] Last processed Gazette ID: ${lastProcessedId || "None"}`
    );

    // 2. Fetch the list of recent gazettes
    const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
    console.log(`[${JOB_NAME}] Fetching recent gazettes: ${gazetteListUrl}`);
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // Delay before first call
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
      } gazettes from API.`
    );

    // 3. Filter out already processed gazettes and determine which ones are new
    const newGazettesToProcess: Gazette[] = [];
    if (gazetteApiData.gazettes?.length > 0) {
      for (const gazette of gazetteApiData.gazettes) {
        if (lastProcessedId && gazette.公報編號 === lastProcessedId) {
          console.log(
            `[${JOB_NAME}] Reached last processed ID (${lastProcessedId}). Stopping gazette check.`
          );
          break; // Stop processing older gazettes
        }
        newGazettesToProcess.push(gazette);
      }
    }

    // Reverse to process from the oldest new one to the newest
    newGazettesToProcess.reverse();
    console.log(
      `[${JOB_NAME}] Found ${newGazettesToProcess.length} new gazettes to process.`
    );

    // 4. Process each new gazette
    for (const gazette of newGazettesToProcess) {
      const currentGazetteId = gazette.公報編號;
      console.log(
        `\n[${JOB_NAME}] Processing NEW Gazette ID: ${currentGazetteId}`
      );
      processedNewGazetteCount++;

      // 4.1 Upsert gazette metadata into 'gazettes' table
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
        continue; // Skip to the next gazette if we can't even save the parent record
      }
      console.log(
        `[${JOB_NAME}] Upserted gazette record for ${currentGazetteId}.`
      );

      // 4.2 Fetch all agendas for this gazette (handle pagination)
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
          `[${JOB_NAME}] Fetching agendas page ${currentPage}/${totalPages} from: ${agendaApiUrl}`
        );

        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // Delay between agenda page fetches

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
          }
          // Update totalPages based on the first successful response, handle potential initial value
          if (currentPage === 1) {
            totalPages = agendaData.total_page || 1;
            console.log(
              `[${JOB_NAME}] Total pages of agendas for ${currentGazetteId}: ${totalPages}`
            );
          } else if (
            agendaData.total_page &&
            agendaData.total_page !== totalPages
          ) {
            // This shouldn't happen often, but good to note if total pages changes mid-fetch
            console.warn(
              `[${JOB_NAME}] Total pages mismatch detected for ${currentGazetteId}. Initial: ${totalPages}, Current: ${agendaData.total_page}`
            );
            totalPages = agendaData.total_page; // Adjust if needed
          }

          currentPage++;
        } catch (fetchError) {
          console.error(
            `[${JOB_NAME}] Failed to fetch agendas page ${currentPage} for ${currentGazetteId}: ${fetchError.message}. Stopping agenda fetch for this gazette.`
          );
          agendaFetchFailed = true;
          break; // Exit the do...while loop
        }
      } while (currentPage <= totalPages);

      if (agendaFetchFailed) {
        console.warn(
          `[${JOB_NAME}] Agenda fetching failed or incomplete for ${currentGazetteId}. Only partially processed agendas (if any) will be saved.`
        );
        // We still process any agendas fetched *before* the failure
        // But we won't mark this gazette_id as the latest *successfully* processed one later
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

        // Find the .txt URL
        const txtUrlObj = agenda.處理後公報網址?.find((u) => u.type === "txt");
        const txtUrl = txtUrlObj?.url || null;

        let initialStatus: "pending" | "failed" = "failed";
        let analysisResultText: string | null = "No txt URL found";

        if (txtUrl) {
          initialStatus = "pending";
          analysisResultText = null; // Ready for analysis
        } else {
          skippedNoTxtUrlCount++;
          console.warn(
            `[${JOB_NAME}] Agenda ${agendaId}: No txt URL found. Status set to 'failed'.`
          );
        }

        // Validate meeting dates
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

        const agendaRecord: GazetteAgendaRecord = {
          agenda_id: agendaId,
          gazette_id: currentGazetteId,
          volume: agenda.卷,
          issue: agenda.期,
          booklet: agenda.冊別,
          session: agenda.屆,
          term: agenda.會期,
          meeting_dates: validMeetingDates,
          subject: agenda.案由,
          start_page: agenda.起始頁碼,
          end_page: agenda.結束頁碼,
          parsed_content_url: txtUrl,
          analysis_status: initialStatus,
          analysis_result: analysisResultText, // Store reason if failed immediately
          analyzed_at: null, // Not analyzed yet
        };

        const { error: agendaUpsertError } = await supabase
          .from("gazette_agendas")
          .upsert(agendaRecord, { onConflict: "agenda_id" });

        if (agendaUpsertError) {
          console.error(
            `[${JOB_NAME}] Error upserting agenda ${agendaId}: ${agendaUpsertError.message}`
          );
          // Continue to next agenda even if one fails
        } else {
          agendasSavedForThisGazette++;
          totalAgendasSaved++;
        }
      } // End agenda loop for this gazette

      console.log(
        `[${JOB_NAME}] Saved ${agendasSavedForThisGazette} agenda records for gazette ${currentGazetteId}.`
      );

      // Only update the 'latestSuccessfullyProcessedGazetteId' if agenda fetching *did not fail* for this gazette
      if (!agendaFetchFailed) {
        latestSuccessfullyProcessedGazetteId = currentGazetteId;
        console.log(
          `[${JOB_NAME}] Marked ${currentGazetteId} as successfully processed.`
        );
      } else {
        console.warn(
          `[${JOB_NAME}] Gazette ${currentGazetteId} not marked as fully processed due to agenda fetch issues.`
        );
      }
    } // End new gazette loop

    // 5. Update job state: Use the latest ID for which *agendas were successfully fetched*
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
        // Log error but don't fail the whole function
      } else {
        console.log(`[${JOB_NAME}] Job state updated successfully.`);
      }
    } else {
      console.log(
        `[${JOB_NAME}] No new gazettes were fully processed successfully. Updating last run time only.`
      );
      // Only update last_run_at if no new gazette was fully processed
      await supabase
        .from("job_state")
        .update({ last_run_at: new Date().toISOString() })
        .eq("job_name", JOB_NAME)
        .maybeSingle(); // Use maybeSingle to avoid error if job_name doesn't exist yet
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] CRITICAL ERROR in main handler:`, error);
    // Ensure job state's last_run_at is updated even on critical failure? Optional.
    // await supabase.from("job_state").update({ last_run_at: new Date().toISOString() }).eq("job_name", JOB_NAME);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Critical error: ${error.message}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 6. Log summary and return success
  const duration = (Date.now() - startTime) / 1000;
  const summary = `Processed ${processedNewGazetteCount} new gazettes. Fetched ${fetchedNewAgendaCount} agendas, saved ${totalAgendasSaved} records. ${skippedNoTxtUrlCount} agendas skipped (no txt url). Duration: ${duration.toFixed(
    2
  )}s.`;
  console.log(`[${JOB_NAME}] Run finished successfully. ${summary}`);

  return new Response(JSON.stringify({ success: true, message: summary }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
