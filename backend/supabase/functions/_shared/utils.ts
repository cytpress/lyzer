import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";

// --- Shared Job Names ---
export const JOB_NAME_FETCHER = "fetch-new-gazettes";
export const JOB_NAME_ANALYZER = "analyze-pending-contents";
export const JOB_NAME_RESCUER = "rescue-stuck-analyses";

// --- Shared Constants ---
export const MAX_RETRIES = 3; // For fetchWithRetry
export const RETRY_DELAY_MS = 1000; // For fetchWithRetry
export const FETCH_DELAY_MS = 600; // General purpose delay
export const LY_API_USER_AGENT =
  "LyGazetteSummarizerBot/2.1 (+https://github.com/your-username/your-repo)"; // 請替換為你的項目URL或聯繫方式

// --- Constants for Analysis Logic (moved from analyze-pending-contents/index.ts) ---
export const MAX_REGULAR_ATTEMPTS = 2;
export const MAX_SHORTENED_ATTEMPTS = 1;
export const STUCK_PROCESSING_THRESHOLD_MINUTES = 15; // 卡住狀態救援閾值 (分鐘)

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
  type: "html" | "tikahtml" | "txt" | "parsed" | string;
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
  gazette_id: string; // PK, NOT NULL
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // 'YYYY-MM-DD'
  fetched_at?: string;
  created_at?: string;
  updated_at?: string;
}

export type AnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped"
  | "needs_shortened_retry"
  | "processing_shortened"
  | "partially_completed";

export interface KeySpeaker {
  speaker_name: string | null;
  speaker_viewpoint: string[] | null;
}

export interface AgendaItem {
  item_title: string | null;
  core_issue: string[] | null;
  controversy: string[] | null;
  key_speakers: KeySpeaker[] | null;
  result_status_next: string[] | null;
}

export interface AnalysisResultJson {
  summary_title: string;
  overall_summary_sentence: string;
  committee_name: string | null;
  agenda_items: AgendaItem[] | null;
}

export interface AnalysisErrorJson {
  error: string;
  details?: string;
}

export interface GeminiErrorDetail extends AnalysisErrorJson {
  type?: string;
  rawOutput?: string;
  parsedResult?: AnalysisResultJson;
}

export interface AnalyzedContentRecord {
  id: string; // PK
  parsed_content_url: string; // UNIQUE, NOT NULL
  analysis_status: AnalysisStatus;
  analysis_result?: AnalysisResultJson | GeminiErrorDetail | null;
  committee_name?: string | null;
  analyzed_at?: string | null;
  analysis_attempts: number; // NOT NULL DEFAULT 0
  shortened_analysis_attempts: number; // NOT NULL DEFAULT 0
  processing_started_at?: string | null;
  error_message?: string | null;
  last_error_type?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GazetteAgendaRecord {
  agenda_id: string; // PK, NOT NULL
  gazette_id: string; // FK, NOT NULL
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
  official_page_url?: string | null;
  official_pdf_url?: string | null;
  fetched_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface JobStateRecord {
  job_name: string; // PK
  last_processed_id?: string | null;
  last_run_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

// --- Shared fetch Function with Retry and Logging ---
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES,
  jobName = "shared-fetch" // Default job name for logging
): Promise<Response> {
  const defaultHeaders = { "User-Agent": LY_API_USER_AGENT };
  const requestOptions = {
    ...options,
    headers: { ...defaultHeaders, ...options?.headers },
  };

  for (let i = 0; i < retries; i++) {
    try {
      console.log(
        `[${jobName}-fetchRetry] 第 ${i + 1}/${retries} 次嘗試抓取: ${url}`
      );
      const response = await fetch(url, requestOptions);
      console.log(
        `[${jobName}-fetchRetry] 第 ${i + 1} 次嘗試收到狀態 ${
          response.status
        } (URL: ${url})`
      );
      if (response.ok) return response;

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        let errorBody = "[無法讀取錯誤內容]";
        try {
          errorBody = await response.text();
        } catch (_) {
          /* 忽略讀取錯誤內容時的錯誤 */
        }
        console.error(
          `[${jobName}-fetchRetry] 客戶端錯誤 ${
            response.status
          }。錯誤內容(前500字元): ${errorBody.substring(0, 500)} (URL: ${url})`
        );
        throw new Error(
          `客戶端錯誤 ${response.status} (URL: ${url})，不再重試。`
        );
      }

      console.warn(
        `[${jobName}-fetchRetry] 第 ${i + 1} 次嘗試失敗: ${response.status} ${
          response.statusText
        } (URL: ${url})`
      );

      if (i < retries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i);
        console.log(
          `[${jobName}-fetchRetry] 等待 ${delay} 毫秒後進行下一次重試...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(
          `[${jobName}-fetchRetry] 最後一次嘗試 ${url} 失敗，狀態碼 ${response.status}`
        );
        throw new Error(
          `抓取 ${url} 失敗，已達最大重試次數 ${retries}。最後狀態碼: ${response.status}`
        );
      }
    } catch (error) {
      console.warn(
        `[${jobName}-fetchRetry] 第 ${i + 1} 次嘗試抓取 ${url} 時發生錯誤: ${
          error.message
        }`
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] 最後一次嘗試 ${url} 因錯誤而失敗。`
        );
        throw error;
      }
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] 發生錯誤後等待 ${delay} 毫秒進行下一次重試...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`從 fetchWithRetry 循環意外退出 (URL: ${url})`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

// --- Supabase Client Initialization Helper ---
let supabaseInstance: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    const errorMsg =
      "環境變數中缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY！";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  supabaseInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  console.log("Supabase 客戶端已初始化 (使用 service_role key)。");
  return supabaseInstance;
}
