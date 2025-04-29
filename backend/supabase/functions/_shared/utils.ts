import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// --- Shared Constants ---
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000; // Initial delay for retries
export const FETCH_DELAY_MS = 600; // Delay BETWEEN different API calls to LY (be respectful)
export const LY_API_USER_AGENT =
  "Mozilla/5.0 (compatible; MySupabaseProjectGazetteBot/1.0; +https://your-project-url.com)"; // *** 請替換成你的項目URL或聯繫方式 ***

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
  卷: number;
  期: number;
  冊別: number;
  屆: number;
  會期: number;
  會議日期: string[]; // Array of YYYY-MM-DD strings
  案由: string;
  起始頁碼: number;
  結束頁碼: number;
  處理後公報網址: ProcessedUrl[];
  公報編號: string;
  // Other fields from API exist but might not be needed for storage
}

export interface AgendaApiResponse {
  total: number;
  total_page: number;
  page: number;
  limit: number;
  gazetteagendas: GazetteAgenda[];
}

// --- Database Record Types (Optional but helpful) ---
export interface GazetteRecord {
  gazette_id: string;
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // Store as string 'YYYY-MM-DD' or Date object
}

export interface GazetteAgendaRecord {
  agenda_id: string;
  gazette_id: string;
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  session?: number | null;
  term?: number | null;
  meeting_dates?: string[] | null; // Store as array of strings
  subject?: string | null;
  start_page?: number | null;
  end_page?: number | null;
  parsed_content_url?: string | null; // Stores the TXT URL
  analysis_status?: "pending" | "processing" | "completed" | "failed";
  analysis_result?: string | null;
  analyzed_at?: string | null; // ISO timestamp string
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
      // Log attempt before fetching
      console.log(
        `[${jobName}-fetchRetry] Attempt ${i + 1}/${retries} fetching: ${url}`
      );
      const response = await fetch(url, requestOptions);

      // Log status after fetching
      console.log(
        `[${jobName}-fetchRetry] Attempt ${i + 1} received status ${
          response.status
        } for: ${url}`
      );

      if (response.ok) {
        return response; // Success!
      }

      // Handle non-OK responses
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} failed: ${response.status} ${
          response.statusText
        }`
      );

      // Don't retry on client errors (4xx) unless it's 429 (Rate Limit)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch (_) {
          /* ignore */
        }
        console.error(
          `[${jobName}-fetchRetry] Client error body (if available): ${errorBody.substring(
            0,
            500
          )}`
        ); // Log part of the body
        throw new Error(`Client error ${response.status} fetching ${url}`);
      }

      // Wait before retrying for server errors (5xx) or rate limits (429)
      if (i < retries - 1) {
        // Only wait if there are more retries left
        const delay = RETRY_DELAY_MS * Math.pow(2, i); // Exponential backoff
        console.log(
          `[${jobName}-fetchRetry] Waiting ${delay}ms before next retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Last attempt failed
        throw new Error(
          `Failed to fetch ${url} after ${retries} attempts. Last status: ${response.status}`
        );
      }
    } catch (error) {
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} threw error for ${url}:`,
        error.message
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] Final attempt failed for ${url}.`
        );
        throw error; // Re-throw the final error
      }
      // Add delay even if fetch itself threw an error (e.g., network issue)
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] Waiting ${delay}ms after error before next retry...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // This line should technically be unreachable due to throws in the loop
  throw new Error(`Unexpected exit from fetchWithRetry loop for ${url}`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
export function isValidDateString(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// --- Supabase Client Initialization Helper ---
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env variables."
    );
  }
  // Ensure Singleton pattern for client if needed, but for Edge Functions, creating per request is often fine.
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
