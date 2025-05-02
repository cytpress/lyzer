import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";

// --- Shared Constants ---
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000; // Initial delay for retries
export const FETCH_DELAY_MS = 600; // Delay BETWEEN different API calls to LY (be respectful)
export const LY_API_USER_AGENT =
  "I just tried to fetch some gazettes."; // *** 建議替換成您的專案 URL 或聯繫方式 ***

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
  卷?: number | null; // API 可能返回 null 或缺少，增加可選性和 null
  期?: number | null;
  冊別?: number | null;
  屆?: number | null;
  會期?: number | null;
  會次?: number | null; // API 有此欄位
  臨時會會次?: number | null; // API 有此欄位
  目錄編號?: number | null; // API 有此欄位
  類別代碼?: number | null; // << 新增: API 的議程類別代碼 >>
  會議日期?: string[] | null; // Array of YYYY-MM-DD strings
  案由?: string | null;
  起始頁碼?: number | null;
  結束頁碼?: number | null;
  doc檔案下載位置?: string[] | null; // API 有此欄位
  屆別期別篩選條件?: string | null; // API 有此欄位
  公報編號: string; // 父層公報的 ID
  公報網網址?: string | null; // API 有此欄位
  公報完整PDF網址?: string | null; // API 有此欄位
  處理後公報網址?: ProcessedUrl[] | null;
}

export interface AgendaApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazetteagendas: GazetteAgenda[]; // API 的 key 是 gazetteagendas
}

// --- Database Record Types (Optional but helpful for type safety) ---
export interface GazetteRecord {
  gazette_id: string; // Primary Key
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // Store as string 'YYYY-MM-DD'
  fetched_at?: string; // Managed by DB default
}

export interface GazetteAgendaRecord {
  agenda_id: string; // Primary Key
  gazette_id: string; // Foreign Key
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  session?: number | null; // Corresponds to API '屆'
  term?: number | null; // Corresponds to API '會期'
  meeting_dates?: string[] | null; // Store as array of 'YYYY-MM-DD' strings
  subject?: string | null; // Corresponds to API '案由'
  category_code?: number | null; // << 新增: Database column for category code >>
  start_page?: number | null;
  end_page?: number | null;
  parsed_content_url?: string | null; // Stores the TXT URL
  analysis_status: "pending" | "processing" | "completed" | "failed"; // Analysis status Enum
  analysis_result?: string | null; // Stores analysis summary or error message
  fetched_at?: string; // Managed by DB default
  analyzed_at?: string | null; // ISO timestamp string when analysis was done
  updated_at?: string; // Managed by DB trigger
}

// --- Shared fetch Function with Retry and Logging ---
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES,
  jobName = "shared-fetch" // To identify which job initiated the fetch in logs
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

      // Don't retry on client errors (4xx) unless it's 429 (Rate Limit)
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

      // Wait before retrying for server errors (5xx) or rate limits (429)
      if (i < retries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i); // Exponential backoff
        console.log(
          `[${jobName}-fetchRetry] Waiting ${delay}ms before next retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Last attempt failed
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
  // Should be unreachable
  throw new Error(`Unexpected exit from fetchWithRetry loop for ${url}`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper ---
// Creates a new client for each Edge Function invocation, suitable for this context.
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // Use Service Role Key for backend functions

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
      // Recommended options for Deno Edge Functions:
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
