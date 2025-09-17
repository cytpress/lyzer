// backend/supabase/functions/backfill-historical-gazettes/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSupabaseClient, FETCH_DELAY_MS } from "../_shared/utils.ts";
import { fetchWithRetry } from "../_shared/utils.ts";
import {
  upsertGazetteRecordToDB,
  upsertAgendaRecordToDB,
} from "../_shared/databaseUpdater.ts";
import { fetchAllAgendasForGazetteFromAPI } from "../_shared/gazetteFetcher.ts";
import type { GazetteApiResponse } from "../_shared/types/api.ts";
import {
  LY_GAZETTE_API_URL_BASE,
  GAZETTES_PER_PAGE,
} from "../_shared/utils.ts";

const JOB_NAME = "backfill-historical-gazettes";

serve(async (req) => {
  const { startPage = 2, pageCount = 10 } = await req.json();
  console.log(
    `[${JOB_NAME}] Function invoked. Starting from page: ${startPage}, processing up to ${pageCount} pages.`
  );

  const supabase = getSupabaseClient();
  let currentPage = startPage;
  const endPage = startPage + pageCount - 1;
  let gazettesProcessed = 0;
  let agendasProcessed = 0;
  let shouldStop = false;

  try {
    while (currentPage <= endPage && !shouldStop) {
      console.log(
        `\n[${JOB_NAME}] Fetching gazettes from page ${currentPage}...`
      );
      const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=${currentPage}&limit=${GAZETTES_PER_PAGE}`;

      await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));

      const response = await fetchWithRetry(
        gazetteListUrl,
        undefined,
        3,
        JOB_NAME
      );
      const apiResponse: GazetteApiResponse = await response.json();
      const fetchedGazettes = apiResponse.gazettes || [];

      if (fetchedGazettes.length === 0) {
        console.log(
          `[${JOB_NAME}] No more gazettes found on page ${currentPage}. Stopping backfill.`
        );
        shouldStop = true;
        break;
      }

      const gazetteIdsFromApi = fetchedGazettes.map((g) => g.公報編號);
      const { data: existingGazettes, error: dbError } = await supabase
        .from("gazettes")
        .select("gazette_id")
        .in("gazette_id", gazetteIdsFromApi);

      if (dbError) {
        throw new Error(
          `DB error checking for existing gazettes: ${dbError.message}`
        );
      }

      const existingIds = new Set(existingGazettes.map((g) => g.gazette_id));

      if (existingIds.size === fetchedGazettes.length) {
        console.log(
          `[${JOB_NAME}] All ${fetchedGazettes.length} gazettes on page ${currentPage} already exist in the DB. Stopping backfill.`
        );
        shouldStop = true;
        break;
      }

      for (const gazette of fetchedGazettes) {
        if (existingIds.has(gazette.公報編號)) {
          console.log(
            `[${JOB_NAME}] Skipping already existing gazette ID: ${gazette.公報編號}`
          );
          continue;
        }

        console.log(
          `[${JOB_NAME}] Processing NEW historical gazette ID: ${gazette.公報編號}`
        );
        const upsertGazetteRes = await upsertGazetteRecordToDB(
          supabase,
          gazette
        );
        if (!upsertGazetteRes.success) {
          console.error(
            `[${JOB_NAME}] Failed to upsert gazette ${gazette.公報編號}, skipping its agendas.`
          );
          continue;
        }

        gazettesProcessed++;

        const { agendas } = await fetchAllAgendasForGazetteFromAPI(
          gazette.公報編號,
          JOB_NAME
        );
        for (const agenda of agendas) {
          await upsertAgendaRecordToDB(
            supabase,
            agenda,
            gazette.公報編號,
            JOB_NAME
          );
          agendasProcessed++;
        }
      }
      currentPage++;
    }

    const summary = `Backfill from page ${startPage} completed. Processed ${gazettesProcessed} new gazettes and ${agendasProcessed} new agendas. Next suggested start page is ${currentPage}.`;
    console.log(`[${JOB_NAME}] ${summary}`);
    return new Response(JSON.stringify({ success: true, message: summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME}] CRITICAL ERROR on page ${currentPage}:`,
      error
    );
    return new Response(JSON.stringify({ success: false, message: errorMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
