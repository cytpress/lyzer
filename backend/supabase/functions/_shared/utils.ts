// supabase/functions/_shared/utils.ts

import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";

// --- Shared Constants ---
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000; // Initial delay for retries
export const FETCH_DELAY_MS = 600; // Delay BETWEEN different API calls to LY (be respectful)
export const LY_API_USER_AGENT =
  "LyGazetteSummarizerBot/1.0 (+https://your-project-url-or-contact)"; // *** 建議替換成您的專案 URL 或聯繫方式 ***

// --- Shared Types (Based on API responses) ---
export interface Gazette {
  卷: number;
  期: number;
  冊別: number;
  發布日期: string; // YYYY-MM-DD
  公報編號: string;
}

export interface GazetteApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazettes: Gazette[];
}

export interface ProcessedUrl {
  type: "html" | "tikahtml" | "txt" | "parsed" | string; // Allow other types just in case
  no: number;
  url: string;
}

export interface GazetteAgenda {
  公報議程編號: string;
  卷?: number | null;
  期?: number | null;
  冊別?: number | null;
  屆?: number | null;
  會期?: number | null;
  會次?: number | null;
  臨時會會次?: number | null;
  目錄編號?: number | null;
  類別代碼?: number | null;
  會議日期?: string[] | null;
  案由?: string | null;
  起始頁碼?: number | null;
  結束頁碼?: number | null;
  doc檔案下載位置?: string[] | null;
  屆別期別篩選條件?: string | null;
  公報編號: string;
  公報網網址?: string | null;
  公報完整PDF網址?: string | null;
  處理後公報網址?: ProcessedUrl[] | null;
}

export interface AgendaApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazetteagendas: GazetteAgenda[];
}

// --- Database Record Types ---
export interface GazetteRecord {
  gazette_id: string; // Primary Key
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // Store as string 'YYYY-MM-DD'
  fetched_at?: string; // Managed by DB default
}

// --- <<< 新增：定義 AI 輸出的 JSON 結構 Interfaces >>> ---
export interface KeySpeakerJson {
  speaker_name: string; // 發言者姓名或單位
  speaker_viewpoint: string; // 其核心觀點/訴求/回應摘要 (Markdown allowed here)
}

export interface AgendaItemJson {
  item_title: string; // 該議程項目的標題 (例如："一、 中華民國113年度中央政府總預算案...")
  core_issue: string; // 核心議題摘要 (Markdown allowed here)
  key_speakers: KeySpeakerJson[] | null; // 主要發言者列表 (若無則為 null)
  controversy: string | null; // 主要爭議/攻防摘要 (Markdown allowed here)。如果無爭議，此欄位值為 null。
  result_status_next: string; // 結果/進度/後續摘要 (Markdown allowed here)
}

export interface AnalysisResultJson {
  summary_title: string; // 會議記錄的簡短標題 (例如："113年度中央政府總預算案三讀通過")
  agenda_items: AgendaItemJson[]; // 包含多個議程項目
  overall_summary_sentence: string; // 摘要開頭的總結句
}

export interface AnalysisErrorJson {
  error: string; // 用於儲存錯誤訊息
}
// --- <<< JSON 結構定義結束 >>> ---

export interface GazetteAgendaRecord {
  agenda_id: string; // Primary Key
  gazette_id: string; // Foreign Key
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  session?: number | null;
  term?: number | null;
  meeting_dates?: string[] | null;
  subject?: string | null;
  category_code?: number | null;
  start_page?: number | null;
  end_page?: number | null;
  parsed_content_url?: string | null;
  analysis_status: "pending" | "processing" | "completed" | "failed";
  // --- <<< 修改：analysis_result 的類型，預期儲存 JSON 結構或錯誤結構 >>> ---
  analysis_result?: AnalysisResultJson | AnalysisErrorJson | null; // << 改為預期接收物件，存入 DB 時會 stringify
  // --- <<< 修改結束 >>> ---
  fetched_at?: string; // Managed by DB default
  analyzed_at?: string | null; // ISO timestamp string when analysis was done
  updated_at?: string; // Managed by DB trigger
}

// --- Shared fetch Function with Retry and Logging (保持不變) ---
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES,
  jobName = "shared-fetch"
): Promise<Response> {
  const defaultHeaders = { "User-Agent": LY_API_USER_AGENT };
  const requestOptions = {
    ...options,
    headers: { ...defaultHeaders, ...options?.headers },
  };

  for (let i = 0; i < retries; i++) {
    try {
      console.log(
        `[${jobName}-fetchRetry] Attempt ${i + 1}/${retries} fetching: ${url}`
      );
      const response = await fetch(url, requestOptions);

      console.log(
        `[${jobName}-fetchRetry] Attempt ${i + 1} received status ${
          response.status
        } for: ${url}`
      );

      if (response.ok) {
        return response; // Success!
      }

      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} failed: ${response.status} ${
          response.statusText
        } for: ${url}`
      );

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        let errorBody = "[Could not read error body]";
        try {
          errorBody = await response.text();
        } catch (_) {
          /* ignore read error */
        }
        console.error(
          `[${jobName}-fetchRetry] Client error ${
            response.status
          }. Body (first 500 chars): ${errorBody.substring(0, 500)}`
        );
        throw new Error(
          `Client error ${response.status} fetching ${url}, not retrying.`
        );
      }

      if (i < retries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i);
        console.log(
          `[${jobName}-fetchRetry] Waiting ${delay}ms before next retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url} with status ${response.status}`
        );
        throw new Error(
          `Failed to fetch ${url} after ${retries} attempts. Last status: ${response.status}`
        );
      }
    } catch (error) {
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${
          i + 1
        } fetch threw error for ${url}:`,
        error.message
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url} due to error.`
        );
        throw error; // Re-throw the final error
      }
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] Waiting ${delay}ms after error before next retry...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Unexpected exit from fetchWithRetry loop for ${url}`);
}

// --- Helper to validate YYYY-MM-DD date strings (保持不變) ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper (保持不變) ---
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) {
    console.error("Missing environment variable: SUPABASE_URL");
    throw new Error("Missing environment variable: SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    console.error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
