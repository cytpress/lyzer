// supabase/functions/_shared/utils.ts

import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";

// --- Shared Constants ---
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000; // Initial delay for retries
export const FETCH_DELAY_MS = 600; // Delay BETWEEN different API calls to LY (be respectful)
export const LY_API_USER_AGENT =
  "LyGazetteSummarizerBot/2.0 (+https://your-project-url-or-contact)"; // 版本更新

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

// --- Database Record Types (重大調整) ---

// 1. gazettes 表記錄
export interface GazetteRecord {
  gazette_id: string; // PK
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // 'YYYY-MM-DD'
  fetched_at?: string; // ISO timestamp
}

// 2. analyzed_contents 表記錄
export interface AnalyzedContentRecord {
  id: string; // PK (UUID)
  parsed_content_url: string; // UNIQUE
  analysis_status: "pending" | "processing" | "completed" | "failed";
  analysis_result?: AnalysisResultJson | AnalysisErrorJson | null; // JSONB
  committee_name?: string | null;
  analyzed_at?: string | null; // ISO timestamp
  created_at?: string; // ISO timestamp
  updated_at?: string; // ISO timestamp
}

// 3. gazette_agendas 表記錄 (調整 - 移除分析相關欄位)
export interface GazetteAgendaRecord {
  agenda_id: string; // PK
  gazette_id: string; // FK
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  session?: number | null;
  term?: number | null;
  meeting_dates?: string[] | null; // Array of 'YYYY-MM-DD'
  subject?: string | null;
  category_code?: number | null;
  start_page?: number | null;
  end_page?: number | null;
  parsed_content_url?: string | null; // <<< 關鍵關聯欄位 >>>
  official_page_url?: string | null;
  official_pdf_url?: string | null;
  fetched_at?: string; // ISO timestamp
  updated_at?: string; // ISO timestamp
}

// --- AI Output JSON Structure Interfaces ---
export interface KeySpeakerJson {
  speaker_name: string;
  speaker_viewpoint: string | string[];
}
export interface AgendaItemJson {
  item_title: string;
  core_issue: string | string[];
  key_speakers: KeySpeakerJson[] | null;
  controversy: string | string[] | null;
  result_status_next: string | string[];
}
export interface AnalysisResultJson {
  // 成功時的結構
  summary_title: string;
  overall_summary_sentence: string;
  committee_name: string | null;
  agenda_items: AgendaItemJson[];
}
export interface AnalysisErrorJson {
  // 失敗時的結構
  error: string;
  details?: string;
}
// --- End JSON Structure Definitions ---

// --- Shared fetch Function with Retry and Logging ---
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

      if (response.ok) return response; // 成功，直接返回

      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} failed: ${response.status} ${
          response.statusText
        } for: ${url}`
      );

      // 對於 4xx 客戶端錯誤（非 429），不重試
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        let errorBody = "[Could not read error body]";
        try {
          errorBody = await response.text();
        } catch (_) {}
        console.error(
          `[${jobName}-fetchRetry] Client error ${
            response.status
          }. Body(500): ${errorBody.substring(0, 500)}`
        );
        throw new Error(
          `Client error ${response.status} fetching ${url}, not retrying.`
        );
      }

      // 對於 5xx 伺服器錯誤或 429，進行重試
      if (i < retries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i); // 指數退避
        console.log(
          `[${jobName}-fetchRetry] Waiting ${delay}ms before next retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // 最後一次嘗試失敗
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url} with status ${response.status}`
        );
        throw new Error(
          `Failed fetch ${url} after ${retries} attempts. Last status: ${response.status}`
        );
      }
    } catch (error) {
      // 處理網路錯誤或上面拋出的客戶端錯誤
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${
          i + 1
        } fetch threw error for ${url}: ${error.message}`
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url} due to error.`
        );
        throw error; // 重新拋出最後的錯誤
      }
      // 網路錯誤後等待重試
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] Waiting ${delay}ms after error before next retry...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // 理論上不應執行到這裡，因為循環內會拋出錯誤
  throw new Error(`Unexpected exit from fetchWithRetry loop for ${url}`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  // 僅做基本格式檢查
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper ---
let supabaseInstance: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase environment variables!");
    throw new Error("Missing Supabase environment variables!");
  }

  supabaseInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  console.log("Supabase client initialized.");
  return supabaseInstance;
}
