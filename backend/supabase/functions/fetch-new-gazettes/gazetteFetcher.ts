import {
  fetchWithRetry,
  FETCH_DELAY_MS,
  JOB_NAME_FETCHER,
} from "../_shared/utils.ts";
import type {
  Gazette,
  GazetteApiResponse,
  GazetteAgenda,
  AgendaApiResponse,
} from "../_shared/types/api.ts"; // Using updated type imports
import {
  LY_GAZETTE_API_URL_BASE,
  GAZETTES_PER_PAGE,
  AGENDAS_PER_PAGE,
} from "./index.ts"; // Import function-specific constants

/**
 * Fetches the most recent gazettes from the LY Gov API.
 * Currently fetches only the first page, assuming recent items are listed there.
 * @returns A promise resolving to an array of `Gazette` objects. Returns an empty array on critical fetch failure.
 */
export async function fetchRecentGazettesFromAPI(): Promise<Gazette[]> {
  const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
  console.log(
    `[${JOB_NAME_FETCHER}] Fetching recent gazettes from: ${gazetteListUrl}`
  );
  await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // Delay before API call

  try {
    const response = await fetchWithRetry(
      gazetteListUrl,
      undefined, // No special fetch options
      3, // Retry count
      JOB_NAME_FETCHER // Job name for logging within fetchWithRetry
    );
    const gazetteApiData: GazetteApiResponse = await response.json();

    // --- Debugging logs: Useful for verifying API response structure ---
    console.log(
      `[${JOB_NAME_FETCHER}] DEBUG: Raw API response for gazettes (first 2 objects):`,
      JSON.stringify(gazetteApiData.gazettes?.slice(0, 2), null, 2)
    );
    if (gazetteApiData.gazettes && gazetteApiData.gazettes.length > 0) {
      const firstGazette = gazetteApiData.gazettes[0];
      console.log(
        `[${JOB_NAME_FETCHER}] DEBUG: Keys in the first gazette object from API: [${Object.keys(
          firstGazette
        ).join(", ")}]`
      );
      // Specifically check for the expected identifier key
      if (Object.hasOwn(firstGazette, "公報編號")) {
        // "公報編號" is "Gazette Number"
        console.log(
          `[${JOB_NAME_FETCHER}] DEBUG: First gazette's '公報編號' value: "${
            firstGazette["公報編號"]
          }", type: ${typeof firstGazette["公報編號"]}`
        );
      } else {
        console.error(
          `[${JOB_NAME_FETCHER}] CRITICAL_DEBUG: Key '公報編號' DOES NOT EXIST in the first gazette object from API!`
        );
      }
    }
    // --- End Debugging logs ---

    console.log(
      `[${JOB_NAME_FETCHER}] Received ${
        gazetteApiData.gazettes?.length || 0
      } gazette(s) from API (Page 1 of ${gazetteApiData.total_page || "?"}).`
    );
    return gazetteApiData.gazettes || []; // Return fetched gazettes or empty array if none
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${JOB_NAME_FETCHER}] CRITICAL: Failed to fetch recent gazettes list: ${errorMsg}. Returning empty list.`
    );
    return []; // Ensure an empty array is returned on critical failure
  }
}

/**
 * Fetches all agenda items for a given gazette ID, handling API pagination.
 * @param gazetteId The unique identifier of the gazette.
 * @returns A promise resolving to an object containing an array of `GazetteAgenda` objects
 *          and a boolean `errorOccurred` indicating if any part of the fetch failed.
 */
export async function fetchAllAgendasForGazetteFromAPI(
  gazetteId: string
): Promise<{ agendas: GazetteAgenda[]; errorOccurred: boolean }> {
  let currentPage = 1;
  let totalPages = 1; // Assume at least one page, will be updated by the first API response
  const allAgendasForThisGazette: GazetteAgenda[] = [];
  let fetchErrorOccurred = false;

  // Validate input gazetteId
  if (!gazetteId || typeof gazetteId !== "string" || gazetteId.trim() === "") {
    console.error(
      `[${JOB_NAME_FETCHER}] fetchAllAgendasForGazetteFromAPI called with invalid gazetteId: "${gazetteId}"`
    );
    return { agendas: [], errorOccurred: true };
  }

  console.log(
    `[${JOB_NAME_FETCHER}] Starting to fetch all agendas for gazette ID: "${gazetteId}"...`
  );

  // Loop through pages as long as there are more pages and no critical error has occurred
  do {
    const agendaApiUrl = `${LY_GAZETTE_API_URL_BASE}/${gazetteId}/agendas?page=${currentPage}&per_page=${AGENDAS_PER_PAGE}`;
    console.log(
      `[${JOB_NAME_FETCHER}] Fetching agendas page ${currentPage}/${
        totalPages === 1 && currentPage === 1 ? "(detecting total)" : totalPages // Indicate if total pages is still unknown
      } from: ${agendaApiUrl}`
    );
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // Delay between page fetches

    try {
      const agendaResponse = await fetchWithRetry(
        agendaApiUrl,
        undefined,
        3, // Retry count for this page fetch
        JOB_NAME_FETCHER
      );
      const agendaData: AgendaApiResponse = await agendaResponse.json();

      // Add fetched agendas to the cumulative list
      if (agendaData.gazetteagendas?.length > 0) {
        allAgendasForThisGazette.push(...agendaData.gazetteagendas);
      } else if (currentPage === 1) {
        // If the first page returns no agendas, log it.
        console.log(
          `[${JOB_NAME_FETCHER}] No agendas listed in API response for gazette "${gazetteId}" (page 1).`
        );
      }

      // Update totalPages from the first API response
      if (currentPage === 1) {
        totalPages = agendaData.total_page || 1; // Default to 1 if API doesn't provide total_page
        console.log(
          `[${JOB_NAME_FETCHER}] API reported total of ${totalPages} page(s) of agendas for gazette "${gazetteId}".`
        );
      }
      currentPage++; // Prepare for the next page
    } catch (fetchError) {
      const errorMsg =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(
        `[${JOB_NAME_FETCHER}] CRITICAL: Failed to fetch agendas page ${currentPage} for gazette "${gazetteId}": ${errorMsg}. Stopping agenda fetch for this gazette.`
      );
      fetchErrorOccurred = true; // Set flag to indicate an error in fetching
      break; // Exit the loop, do not attempt further pages for this gazette
    }
  } while (currentPage <= totalPages); // Loop condition

  if (fetchErrorOccurred) {
    console.warn(
      `[${JOB_NAME_FETCHER}] Agenda fetching may be incomplete for gazette "${gazetteId}". Processed ${allAgendasForThisGazette.length} agenda(s) before error.`
    );
  } else {
    console.log(
      `[${JOB_NAME_FETCHER}] Successfully fetched all ${
        allAgendasForThisGazette.length
      } listed agenda(s) across ${
        totalPages > 0 ? totalPages : 1
      } page(s) for gazette "${gazetteId}".`
    );
  }
  return {
    agendas: allAgendasForThisGazette,
    errorOccurred: fetchErrorOccurred,
  };
}
