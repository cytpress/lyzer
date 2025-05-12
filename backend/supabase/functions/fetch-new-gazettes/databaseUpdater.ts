// supabase/functions/fetch-new-gazettes/databaseUpdater.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  Gazette,
  GazetteAgenda,
  GazetteRecord,
  GazetteAgendaRecord,
  JobStateRecord,
  ProcessedUrl,
} from "../_shared/utils.ts"; // <<< 路徑修正 >>>
import { isValidDateString } from "../_shared/utils.ts"; // <<< isValidDateString 在這裡被使用 >>>
import { JOB_NAME_FETCHER } from "./index.ts";

export async function upsertGazetteRecordToDB(
  supabase: SupabaseClient,
  gazetteApiData: Gazette
): Promise<{ success: boolean; error?: string; gazetteId?: string }> {
  // 從 API 數據構造資料庫記錄前，嚴格檢查 gazette_id
  // gazetteApiData.公報編號 應該是 string 類型，由調用者保證 (例如在 index.ts 中檢查)
  const gazetteIdToUpsert = String(gazetteApiData.公報編號 || "").trim();

  if (!gazetteIdToUpsert) {
    const errMsg = `upsertGazetteRecordToDB received invalid '公報編號' (empty or null/undefined) from API data. API Object: ${JSON.stringify(
      gazetteApiData
    )}`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    return { success: false, error: errMsg };
  }

  const gazetteRecord: GazetteRecord = {
    gazette_id: gazetteIdToUpsert, // 這裡的 gazetteIdToUpsert 應該是經過驗證的字符串
    volume: gazetteApiData.卷,
    issue: gazetteApiData.期,
    booklet: gazetteApiData.冊別,
    publish_date: isValidDateString(gazetteApiData.發布日期)
      ? gazetteApiData.發布日期
      : null,
    // fetched_at, created_at, updated_at 由 DB DEFAULT 或觸發器管理
  };

  console.log(
    `[${JOB_NAME_FETCHER}] Attempting to upsert gazette_id: "${gazetteRecord.gazette_id}" with data:`,
    JSON.stringify(gazetteRecord)
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
      gazetteId: gazetteRecord.gazette_id,
    };
  }
  console.log(
    `[${JOB_NAME_FETCHER}] Upserted gazette record for "${gazetteRecord.gazette_id}".`
  );
  return { success: true, gazetteId: gazetteRecord.gazette_id };
}

export async function upsertAgendaRecordToDB(
  supabase: SupabaseClient,
  agendaApiData: GazetteAgenda,
  gazetteId: string
): Promise<{
  success: boolean;
  error?: string;
  parsedContentUrl: string | null;
}> {
  const agendaIdToUpsert = String(agendaApiData.公報議程編號 || "").trim();
  if (!agendaIdToUpsert) {
    const errMsg = `Invalid or missing '公報議程編號' in API data for upsertAgendaRecordToDB. Gazette ID: ${gazetteId}, API Object: ${JSON.stringify(
      agendaApiData
    )}`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    return { success: false, error: errMsg, parsedContentUrl: null };
  }
  // 確保傳入的 gazetteId 是有效的
  if (!gazetteId || typeof gazetteId !== "string" || gazetteId.trim() === "") {
    const errMsg = `upsertAgendaRecordToDB called with invalid parent gazetteId: "${gazetteId}" for agenda "${agendaIdToUpsert}"`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    return { success: false, error: errMsg, parsedContentUrl: null };
  }

  const txtUrlObj = agendaApiData.處理後公報網址?.find(
    (u: ProcessedUrl) => u.type === "txt"
  );
  const txtUrl = txtUrlObj?.url || null;

  const validMeetingDates =
    agendaApiData.會議日期?.filter(isValidDateString) || null;
  if (
    agendaApiData.會議日期 &&
    (!validMeetingDates ||
      validMeetingDates.length !== agendaApiData.會議日期.length)
  ) {
    console.warn(
      `[${JOB_NAME_FETCHER}] Agenda ${agendaIdToUpsert}: Filtered potentially invalid meeting dates.`
    );
  }

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
    // fetched_at, created_at, updated_at 由 DB 管理
  };

  const { error } = await supabase
    .from("gazette_agendas")
    .upsert(agendaRecord, { onConflict: "agenda_id" });
  if (error) {
    // 這裡的錯誤日誌是針對 agenda 的，不是 gazette 的
    console.error(
      `[${JOB_NAME_FETCHER}] Error upserting agenda metadata "${agendaRecord.agenda_id}" for gazette "${gazetteId}": ${error.message}`
    );
    return { success: false, error: error.message, parsedContentUrl: txtUrl };
  }
  return { success: true, parsedContentUrl: txtUrl };
}

export async function addUrlsToAnalysisQueueDB(
  supabase: SupabaseClient,
  urls: Set<string>
): Promise<{ count: number; error?: string }> {
  // ... (此函數邏輯不變)
  if (urls.size === 0) {
    console.log(
      `[${JOB_NAME_FETCHER}] No new unique content URLs found to add to analysis queue.`
    );
    return { count: 0 };
  }
  console.log(
    `[${JOB_NAME_FETCHER}] Found ${urls.size} unique new URLs to add to analysis queue.`
  );
  const recordsToUpsert = Array.from(urls).map((url) => ({
    parsed_content_url: url,
  }));

  const { error } = await supabase
    .from("analyzed_contents")
    .upsert(recordsToUpsert, {
      onConflict: "parsed_content_url",
      ignoreDuplicates: true,
    });

  if (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Error upserting new URLs into analyzed_contents: ${error.message}`
    );
    return { count: 0, error: error.message };
  }
  console.log(
    `[${JOB_NAME_FETCHER}] Attempted to upsert ${urls.size} URLs into analysis queue (duplicates ignored).`
  );
  return { count: urls.size };
}

export async function updateJobStateInDB(
  supabase: SupabaseClient,
  jobName: string,
  lastProcessedIdValue: string | null, // 可以是 null
  notes?: string
): Promise<void> {
  // ... (此函數邏輯不變)
  const payload: Partial<JobStateRecord> & { job_name: string } = {
    job_name: jobName,
    last_run_at: new Date().toISOString(),
  };
  if (lastProcessedIdValue !== undefined) {
    payload.last_processed_id = lastProcessedIdValue;
  }
  if (notes !== undefined) {
    payload.notes = notes;
  }

  const { error } = await supabase
    .from("job_state")
    .upsert(payload, { onConflict: "job_name" });

  if (error) {
    console.error(
      `[${jobName}] CRITICAL: Error updating job state: ${error.message}`
    );
  } else {
    const LPI =
      payload.last_processed_id === undefined
        ? "(not updated)"
        : payload.last_processed_id ?? "None";
    console.log(
      `[${jobName}] Job state updated successfully. Last Processed ID: ${LPI}. Notes: ${
        notes ?? ""
      }`
    );
  }
}
