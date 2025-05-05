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
  公報網網址?: string | null; // <<< Data source for official_page_url
  公報完整PDF網址?: string | null; // <<< Data source for official_pdf_url
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

// --- AI Output JSON Structure Interfaces ---
export interface KeySpeakerJson {
  speaker_name: string;
  speaker_viewpoint: string;
}

export interface AgendaItemJson {
  item_title: string;
  core_issue: string;
  key_speakers: KeySpeakerJson[] | null;
  controversy: string | null;
  result_status_next: string;
}

export interface AnalysisResultJson {
  summary_title: string;
  agenda_items: AgendaItemJson[];
  overall_summary_sentence: string;
}

export interface AnalysisErrorJson {
  error: string; // Used to store error messages in JSON format
  details?: string; // Optional field for more details
}
// --- End JSON Structure Definitions ---

// Interface for the record stored in the gazette_agendas table
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
  official_page_url?: string | null; // <<< ADDED >>> To store 公報網網址
  official_pdf_url?: string | null; // <<< ADDED >>> To store 公報完整PDF網址
  analysis_status: "pending" | "processing" | "completed" | "failed";
  // analysis_result now expects a proper JSON object (or null)
  // The fetch function should ideally store AnalysisErrorJson for failures like missing txt URL
  analysis_result?: AnalysisResultJson | AnalysisErrorJson | null;
  fetched_at?: string; // Managed by DB default (ISO timestamp string)
  analyzed_at?: string | null; // ISO timestamp string when analysis was done
  updated_at?: string; // Managed by DB trigger (ISO timestamp string)
}

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

      if (response.ok) {
        return response; // Success!
      }

      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} failed: ${response.status} ${
          response.statusText
        } for: ${url}`
      );

      // Don't retry client errors (4xx) except for 429 (Too Many Requests)
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

      // Retry on server errors (5xx) or 429
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
      // Handle network errors or errors thrown from the client error check
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
      // Wait before retrying after a network error
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] Waiting ${delay}ms after error before next retry...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Should theoretically not be reached due to throws in the loop
  throw new Error(`Unexpected exit from fetchWithRetry loop for ${url}`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  // Basic check, doesn't validate day/month relationship or leap years
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper ---
// Ensure Supabase URL and Service Role Key are set in your environment variables
// (e.g., in your .env file for local development or Edge Function settings)
let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

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

  // Create a single instance for the function invocation
  supabaseInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false, // Required for service_role access
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  console.log("Supabase client initialized."); // Log initialization
  return supabaseInstance;
}
