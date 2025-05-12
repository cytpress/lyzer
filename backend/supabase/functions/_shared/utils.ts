// supabase/functions/_shared/utils.ts

import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";

// --- Shared Constants ---
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;
export const FETCH_DELAY_MS = 600;
export const LY_API_USER_AGENT =
  "LyGazetteSummarizerBot/2.1 (+https://your-project-url-or-contact)";

// --- Shared Types (Based on API responses) ---
export interface Gazette {
  // 來自 API 的原始公報數據結構
  卷: number;
  期: number;
  冊別: number;
  發布日期: string; // YYYY-MM-DD
  公報編號: string; // <<< 極其重要：確保這個鍵名與 API 返回完全一致！>>>
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
  // 來自 API 的原始議程數據結構
  公報議程編號: string; // <<< 極其重要：確保這個鍵名與 API 返回完全一致！>>>
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
  公報編號: string; // API 返回的議程中也包含其所屬公報的編號
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
  // 對應 DB gazettes 表
  gazette_id: string; // PK, NOT NULL
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // 'YYYY-MM-DD'
  fetched_at?: string; // 由 DB DEFAULT NOW()
  created_at?: string; // 由 DB DEFAULT NOW()
  updated_at?: string; // 由 DB DEFAULT NOW() 或 trigger
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

export interface AnalysisResultJson {
  /* ...你的定義... */ summary_title: string;
  overall_summary_sentence: string;
  committee_name: string | null;
  agenda_items: any[];
}
export interface AnalysisErrorJson {
  error: string;
  details?: string;
}
export interface GeminiErrorDetail extends AnalysisErrorJson {
  type?: string;
  rawOutput?: string;
  candidatesTokenCount?: number;
  parsedResult?: AnalysisResultJson;
}

export interface AnalyzedContentRecord {
  // 對應 DB analyzed_contents 表
  id: string; // PK
  parsed_content_url: string; // UNIQUE, NOT NULL
  analysis_status: AnalysisStatus;
  analysis_result?:
    | AnalysisResultJson
    | AnalysisErrorJson
    | GeminiErrorDetail
    | null;
  committee_name?: string | null;
  analyzed_at?: string | null;
  analysis_attempts: number; // NOT NULL DEFAULT 0
  shortened_analysis_attempts: number; // NOT NULL DEFAULT 0
  processing_started_at?: string | null;
  error_message?: string | null;
  last_error_type?: string | null;
  created_at: string; // NOT NULL DEFAULT NOW()
  updated_at: string; // NOT NULL DEFAULT NOW() 或 trigger
}

export interface GazetteAgendaRecord {
  // 對應 DB gazette_agendas 表
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
  parsed_content_url?: string | null; // 在此表允許重複
  official_page_url?: string | null;
  official_pdf_url?: string | null;
  fetched_at?: string; // NOT NULL DEFAULT NOW()
  created_at?: string; // NOT NULL DEFAULT NOW()
  updated_at?: string; // NOT NULL DEFAULT NOW() 或 trigger
}

export interface JobStateRecord {
  // 對應 DB job_state 表
  job_name: string; // PK
  last_processed_id?: string | null;
  last_run_at?: string | null;
  notes?: string | null;
  created_at: string; // NOT NULL DEFAULT NOW()
  updated_at: string; // NOT NULL DEFAULT NOW() 或 trigger
}

// --- Shared fetch Function with Retry and Logging ---
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES,
  jobName = "shared-fetch" // 默認值，會被調用處傳入的覆蓋
): Promise<Response> {
  // ... (fetchWithRetry 函數實現，使用 jobName 參數，與之前修正的一致)
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
      if (response.ok) return response;
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
          `Failed fetch ${url} after ${retries} attempts. Last status: ${response.status}`
        );
      }
    } catch (error) {
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${
          i + 1
        } fetch threw error for ${url}: ${error.message}`
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url} due to error.`
        );
        throw error;
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

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper ---
let supabaseInstance: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables!"
    );
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables!"
    );
  }
  supabaseInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  console.log("Supabase client initialized (using service_role key).");
  return supabaseInstance;
}
