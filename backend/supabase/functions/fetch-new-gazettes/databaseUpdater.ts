import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isValidDateString, JOB_NAME_FETCHER } from "../_shared/utils.ts";
import type {
  Gazette,
  GazetteAgenda,
  ProcessedUrl,
} from "../_shared/types/api.ts";
import type {
  GazetteRecord,
  GazetteAgendaRecord,
  AnalyzedContentRecord,
} from "../_shared/types/database.ts";
// Note: updateJobStateInDB was moved to _shared/utils.ts

/**
 * Upserts a Gazette record into the database.
 * Maps API data to the `GazetteRecord` structure.
 * @param supabase Supabase client instance.
 * @param gazetteApiData Data object for a single gazette from the API.
 * @returns An object indicating success, error message, and the gazette ID.
 */
export async function upsertGazetteRecordToDB(
  supabase: SupabaseClient,
  gazetteApiData: Gazette // Expecting API type
): Promise<{ success: boolean; error?: string; gazetteId?: string }> {
  const gazetteIdToUpsert = String(gazetteApiData.公報編號 || "").trim();

  if (!gazetteIdToUpsert) {
    const errMsg = `upsertGazetteRecordToDB received invalid '公報編號' (gazette ID) from API data. API Object: ${JSON.stringify(
      gazetteApiData
    )}`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    return { success: false, error: errMsg };
  }

  // Map API type to DB record type
  const gazetteRecord: GazetteRecord = {
    gazette_id: gazetteIdToUpsert,
    volume: gazetteApiData.卷,
    issue: gazetteApiData.期,
    booklet: gazetteApiData.冊別,
    publish_date: isValidDateString(gazetteApiData.發布日期)
      ? gazetteApiData.發布日期
      : null,
    // fetched_at, created_at, updated_at are typically handled by DB defaults/triggers
  };

  console.log(
    `[${JOB_NAME_FETCHER}] Attempting to upsert gazette_id: "${gazetteRecord.gazette_id}"` // Avoid logging full data unless debugging
  );
  const { error } = await supabase
    .from("gazettes")
    .upsert(gazetteRecord, { onConflict: "gazette_id" });

  if (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Error upserting gazette record "${gazetteRecord.gazette_id}": ${error.message}.`
    );
    return {
      success: false,
      error: error.message,
      gazetteId: gazetteRecord.gazette_id, // Return ID for logging context
    };
  }
  console.log(
    `[${JOB_NAME_FETCHER}] Successfully upserted gazette record for ID "${gazetteRecord.gazette_id}".`
  );
  return { success: true, gazetteId: gazetteRecord.gazette_id };
}

/**
 * Upserts a Gazette Agenda record into the database.
 * Maps API data to `GazetteAgendaRecord` and extracts the plain text URL.
 * @param supabase Supabase client instance.
 * @param agendaApiData Data object for a single gazette agenda from the API.
 * @param gazetteId The confirmed parent gazette_id (already in DB).
 * @returns An object indicating success, error, and the `parsedContentUrl`.
 */
export async function upsertAgendaRecordToDB(
  supabase: SupabaseClient,
  agendaApiData: GazetteAgenda, // Expecting API type
  gazetteId: string // Confirmed parent ID from DB
): Promise<{
  success: boolean;
  error?: string;
  parsedContentUrl: string | null;
}> {
  const agendaIdToUpsert = String(agendaApiData.公報議程編號 || "").trim();
  if (!agendaIdToUpsert) {
    const errMsg = `Invalid or missing '公報議程編號' (agenda ID) in API data for upsertAgendaRecordToDB. Gazette ID: ${gazetteId}, API Object: ${JSON.stringify(
      agendaApiData
    )}`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    // Attempt to return URL even if upsert fails due to missing ID
    const txtUrlObjOnError = agendaApiData.處理後公報網址?.find(
      (u: ProcessedUrl) => u.type === "txt"
    );
    return {
      success: false,
      error: errMsg,
      parsedContentUrl: txtUrlObjOnError?.url || null,
    };
  }

  if (!gazetteId || typeof gazetteId !== "string" || gazetteId.trim() === "") {
    const errMsg = `upsertAgendaRecordToDB called with invalid parent gazetteId: "${gazetteId}" for agenda "${agendaIdToUpsert}"`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    const txtUrlObjOnError = agendaApiData.處理後公報網址?.find(
      (u: ProcessedUrl) => u.type === "txt"
    );
    return {
      success: false,
      error: errMsg,
      parsedContentUrl: txtUrlObjOnError?.url || null,
    };
  }

  // Extract plain text URL for analysis queue
  const txtUrlObj = agendaApiData.處理後公報網址?.find(
    (u: ProcessedUrl) => u.type === "txt"
  );
  const txtUrl = txtUrlObj?.url || null;

  // Validate meeting dates
  const validMeetingDates =
    agendaApiData.會議日期?.filter(isValidDateString) || null;
  if (
    agendaApiData.會議日期 &&
    (!validMeetingDates ||
      validMeetingDates.length !== agendaApiData.會議日期.length)
  ) {
    console.warn(
      `[${JOB_NAME_FETCHER}] Agenda ${agendaIdToUpsert}: Filtered potentially invalid meeting dates. Original: ${JSON.stringify(
        agendaApiData.會議日期
      )}, Validated: ${JSON.stringify(validMeetingDates)}`
    );
  }

  // Map API type to DB record type
  const agendaRecord: GazetteAgendaRecord = {
    agenda_id: agendaIdToUpsert,
    gazette_id: gazetteId,
    volume: agendaApiData.卷 ?? null,
    issue: agendaApiData.期 ?? null,
    booklet: agendaApiData.冊別 ?? null,
    session: agendaApiData.屆 ?? null,
    term: agendaApiData.會期 ?? null,
    meeting_dates: validMeetingDates,
    subject: agendaApiData.案由 ?? null,
    category_code: agendaApiData.類別代碼 ?? null,
    start_page: agendaApiData.起始頁碼 ?? null,
    end_page: agendaApiData.結束頁碼 ?? null,
    parsed_content_url: txtUrl,
    official_page_url: agendaApiData.公報網網址 ?? null,
    official_pdf_url: agendaApiData.公報完整PDF網址 ?? null,
    // fetched_at, created_at, updated_at handled by DB
  };

  const { error } = await supabase
    .from("gazette_agendas")
    .upsert(agendaRecord, { onConflict: "agenda_id" });

  if (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Error upserting agenda metadata "${agendaRecord.agenda_id}" for gazette "${gazetteId}": ${error.message}`
    );
    return { success: false, error: error.message, parsedContentUrl: txtUrl }; // Return URL even on DB error
  }
  // console.log(`[${JOB_NAME_FETCHER}] Successfully upserted agenda record "${agendaRecord.agenda_id}".`); // Optional: can be verbose
  return { success: true, parsedContentUrl: txtUrl };
}

/**
 * Adds a set of unique content URLs to the `analyzed_contents` table.
 * Uses `ignoreDuplicates: true` to only insert new URLs.
 * @param supabase Supabase client instance.
 * @param urls A Set of unique `parsed_content_url` strings.
 * @returns An object with the count of newly inserted URLs and an optional error message.
 */
export async function addUrlsToAnalysisQueueDB(
  supabase: SupabaseClient,
  urls: Set<string>
): Promise<{ count: number; error?: string }> {
  if (urls.size === 0) {
    console.log(
      `[${JOB_NAME_FETCHER}] No new unique content URLs found to add to analysis queue.`
    );
    return { count: 0 };
  }
  console.log(
    `[${JOB_NAME_FETCHER}] Found ${urls.size} unique URL(s) to potentially add to analysis queue (duplicates will be ignored).`
  );

  // Prepare records for insertion. DB defaults should set status to 'pending'.
  const recordsToUpsert: Pick<AnalyzedContentRecord, "parsed_content_url">[] =
    Array.from(urls).map((url) => ({
      parsed_content_url: url,
    }));

  // Upsert with ignoreDuplicates: true ensures only new URLs are inserted.
  // Existing entries with the same parsed_content_url are not modified.
  const { error, count } = await supabase
    .from("analyzed_contents")
    .upsert(recordsToUpsert, {
      onConflict: "parsed_content_url", // The column with the unique constraint
      ignoreDuplicates: true,
    });

  if (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Error adding new URLs to 'analyzed_contents' table: ${error.message}`
    );
    return { count: 0, error: error.message }; // Report 0 count on error
  }

  // 'count' from upsert with ignoreDuplicates should be the number of newly inserted rows.
  console.log(
    `[${JOB_NAME_FETCHER}] Attempted to add ${
      urls.size
    } URL(s) to analysis queue. ${
      count ?? 0
    } new URL(s) were inserted (duplicates ignored).`
  );
  return { count: count ?? 0 }; // Return the count of *newly* inserted URLs
}
