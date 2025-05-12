import {
  fetchWithRetry,
  Gazette,
  GazetteApiResponse,
  GazetteAgenda,
  AgendaApiResponse,
  FETCH_DELAY_MS,
  JOB_NAME_FETCHER, // 從 _shared 導入
} from "../_shared/utils.ts";
import {
  // JOB_NAME_FETCHER, // 不再從這裡導入
  LY_GAZETTE_API_URL_BASE,
  GAZETTES_PER_PAGE,
  AGENDAS_PER_PAGE,
} from "./index.ts"; // 從同目錄的 index.ts 導入此 Function 特有的配置

export async function fetchRecentGazettesFromAPI(): Promise<Gazette[]> {
  const gazetteListUrl = `${LY_GAZETTE_API_URL_BASE}?page=1&per_page=${GAZETTES_PER_PAGE}`;
  console.log(
    `[${JOB_NAME_FETCHER}] Fetching recent gazettes: ${gazetteListUrl}`
  );
  await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // 使用共享的 FETCH_DELAY_MS

  const response = await fetchWithRetry(
    gazetteListUrl,
    undefined,
    3, // 可以考慮將此重試次數也設為共享常量
    JOB_NAME_FETCHER // 傳遞 Job Name 給 fetchWithRetry
  );
  const gazetteApiData: GazetteApiResponse = await response.json();

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
    if (Object.hasOwn(firstGazette, "公報編號")) {
      console.log(
        `[${JOB_NAME_FETCHER}] DEBUG: First gazette's '公報編號' value: "${
          firstGazette["公報編號"]
        }", type: ${typeof firstGazette["公報編號"]}`
      );
    } else {
      console.error(
        `[${JOB_NAME_FETCHER}] CRITICAL_DEBUG: '公報編號' key DOES NOT EXIST in the first gazette object from API!`
      );
    }
  }

  console.log(
    `[${JOB_NAME_FETCHER}] Received ${
      gazetteApiData.gazettes?.length || 0
    } gazettes (Page 1 of ${gazetteApiData.total_page || "?"}).`
  );
  return gazetteApiData.gazettes || [];
}

export async function fetchAllAgendasForGazetteFromAPI(
  gazetteId: string
): Promise<{ agendas: GazetteAgenda[]; errorOccurred: boolean }> {
  let currentPage = 1;
  let totalPages = 1;
  const allAgendasForThisGazette: GazetteAgenda[] = [];
  let fetchErrorOccurred = false;

  if (!gazetteId || typeof gazetteId !== "string" || gazetteId.trim() === "") {
    console.error(
      `[${JOB_NAME_FETCHER}] fetchAllAgendasForGazetteFromAPI called with invalid gazetteId: "${gazetteId}"`
    );
    return { agendas: [], errorOccurred: true };
  }

  console.log(
    `[${JOB_NAME_FETCHER}] Starting to fetch agendas for valid gazette ID: "${gazetteId}"...`
  );
  do {
    const agendaApiUrl = `${LY_GAZETTE_API_URL_BASE}/${gazetteId}/agendas?page=${currentPage}&per_page=${AGENDAS_PER_PAGE}`;
    console.log(
      `[${JOB_NAME_FETCHER}] Fetching agendas page ${currentPage}/${
        totalPages === 1 && currentPage === 1 ? "?" : totalPages
      } from: ${agendaApiUrl}`
    );
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS)); // 使用共享的 FETCH_DELAY_MS

    try {
      const agendaResponse = await fetchWithRetry(
        agendaApiUrl,
        undefined,
        3,
        JOB_NAME_FETCHER // 傳遞 Job Name
      );
      const agendaData: AgendaApiResponse = await agendaResponse.json();

      if (agendaData.gazetteagendas?.length > 0) {
        allAgendasForThisGazette.push(...agendaData.gazetteagendas);
      } else if (currentPage === 1) {
        console.log(
          `[${JOB_NAME_FETCHER}] No agendas listed in API response for gazette "${gazetteId}".`
        );
      }

      if (currentPage === 1) {
        totalPages = agendaData.total_page || 1;
        console.log(
          `[${JOB_NAME_FETCHER}] Total pages of agendas reported by API for gazette "${gazetteId}": ${totalPages}`
        );
      }
      currentPage++;
    } catch (fetchError) {
      console.error(
        `[${JOB_NAME_FETCHER}] CRITICAL: Failed to fetch agendas page ${currentPage} for gazette "${gazetteId}": ${fetchError.message}. Stopping agenda fetch for this gazette.`
      );
      fetchErrorOccurred = true;
      break;
    }
  } while (currentPage <= totalPages && !fetchErrorOccurred);

  if (fetchErrorOccurred) {
    console.warn(
      `[${JOB_NAME_FETCHER}] Agenda fetching may be incomplete for gazette "${gazetteId}". Processed ${allAgendasForThisGazette.length} agendas before error.`
    );
  } else {
    console.log(
      `[${JOB_NAME_FETCHER}] Successfully fetched all ${allAgendasForThisGazette.length} listed agendas for gazette "${gazetteId}".`
    );
  }
  return {
    agendas: allAgendasForThisGazette,
    errorOccurred: fetchErrorOccurred,
  };
}
