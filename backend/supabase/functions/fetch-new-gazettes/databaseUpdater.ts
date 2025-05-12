import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  Gazette,
  GazetteAgenda,
  GazetteRecord,
  GazetteAgendaRecord,
  JobStateRecord,
  ProcessedUrl,
} from "../_shared/utils.ts";
import { isValidDateString, JOB_NAME_FETCHER } from "../_shared/utils.ts"; // 從 _shared 導入 JOB_NAME_FETCHER

// JOB_NAME_FETCHER 不再從同目錄的 index.ts 導入

export async function upsertGazetteRecordToDB(
  supabase: SupabaseClient,
  gazetteApiData: Gazette
): Promise<{ success: boolean; error?: string; gazetteId?: string }> {
  const gazetteIdToUpsert = String(gazetteApiData.公報編號 || "").trim();

  if (!gazetteIdToUpsert) {
    const errMsg = `upsertGazetteRecordToDB received invalid '公報編號' (empty or null/undefined) from API data. API Object: ${JSON.stringify(
      gazetteApiData
    )}`;
    console.error(`[${JOB_NAME_FETCHER}] ${errMsg}`);
    return { success: false, error: errMsg };
  }

  const gazetteRecord: GazetteRecord = {
    gazette_id: gazetteIdToUpsert,
    volume: gazetteApiData.卷,
    issue: gazetteApiData.期,
    booklet: gazetteApiData.冊別,
    publish_date: isValidDateString(gazetteApiData.發布日期)
      ? gazetteApiData.發布日期
      : null,
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
  gazetteId: string // 這個 gazetteId 應該是已經確認存在於 DB 中的 ID
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
      `[${JOB_NAME_FETCHER}] Agenda ${agendaIdToUpsert}: Filtered potentially invalid meeting dates. Original: ${JSON.stringify(
        agendaApiData.會議日期
      )}, Validated: ${JSON.stringify(validMeetingDates)}`
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
  };

  const { error } = await supabase
    .from("gazette_agendas")
    .upsert(agendaRecord, { onConflict: "agenda_id" });
  if (error) {
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
    // 預設狀態 'pending' 和其他預設值由 DB schema 或 trigger 處理
  }));

  const { error, count } = await supabase // 'count' 可以用來確認實際插入/更新的數量
    .from("analyzed_contents")
    .upsert(recordsToUpsert, {
      onConflict: "parsed_content_url",
      ignoreDuplicates: false, // 設為 false 以便 onConflict 生效，讓 created_at/updated_at 更新 (如果 DB schema 這樣配置)
      // 或者，如果只想插入新的，設為 true，並依賴 DB 的 default 值
      // 這裡保持 false，並假設 DB 會處理 'pending' 狀態
      // 實際上，如果只想插入不存在的，用 ignoreDuplicates: true 更好
      // 如果希望已存在的也被更新（例如重置狀態），則需要更複雜的邏輯或不同的 upsert
      // 鑒於此函數目的是“添加”到隊列，ignoreDuplicates: true 且DB有default 'pending'是合理的
      // 但為了與你現有邏輯一致（可能是希望更新已存在的為 pending），暫時保留 ignoreDuplicates: false
      // 但更常見的做法是，如果 parsed_content_url 已存在，則不進行任何操作。
      // 或者，如果需要重置狀態，那應該是另一個邏輯。
      // 假設：如果URL已存在，我們什麼都不做。
    });

  if (error) {
    console.error(
      `[${JOB_NAME_FETCHER}] Error upserting new URLs into analyzed_contents: ${error.message}`
    );
    return { count: 0, error: error.message };
  }
  // Supabase v2 upsert 返回的 count 可能為 null，或者代表受影響的行數。
  // 如果 ignoreDuplicates: true, count 可能只計算新插入的。
  // 這裡我們更關心的是 urls.size，因為這是我們嘗試添加的數量。
  console.log(
    `[${JOB_NAME_FETCHER}] Attempted to upsert ${
      urls.size
    } URLs into analysis queue. DB reported ${count ?? "N/A"} affected rows.`
  );
  return { count: urls.size }; // 返回嘗試添加的數量
}

export async function updateJobStateInDB(
  supabase: SupabaseClient,
  jobName: string, // 這個 jobName 會是 JOB_NAME_FETCHER, JOB_NAME_ANALYZER 等
  lastProcessedIdValue: string | null | undefined, // 允許 undefined 表示不更新此字段
  notes?: string
): Promise<void> {
  const payload: Partial<JobStateRecord> & { job_name: string } = {
    job_name: jobName,
    last_run_at: new Date().toISOString(),
  };
  if (lastProcessedIdValue !== undefined) {
    // 只有在提供了值 (包括 null) 時才更新
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
        : payload.last_processed_id === null
        ? "None (cleared)"
        : payload.last_processed_id;
    console.log(
      `[${jobName}] Job state updated successfully. Last Processed ID: ${LPI}. Notes: ${
        notes ?? ""
      }`
    );
  }
}
