import { SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";
import type { JobStateRecord } from "./types/database.ts"; // Import necessary type

// --- Shared Job Names ---
// Consistent identifiers for background jobs.
export const JOB_NAME_FETCHER = "fetch-new-gazettes";
export const JOB_NAME_ANALYZER = "analyze-pending-contents";
export const JOB_NAME_RESCUER = "rescue-stuck-analyses";

// --- Shared Constants ---
export const MAX_RETRIES = 3; // Default max retries for fetchWithRetry.
export const RETRY_DELAY_MS = 1000; // Initial delay for fetchWithRetry (uses exponential backoff).
export const FETCH_DELAY_MS = 600; // General short delay between operations (e.g., API calls).
export const LY_API_USER_AGENT =
  "LyGazetteSummarizerBot/2.1 (+https://github.com/your-username/your-repo)"; // TODO: Replace with your project/contact info.

// --- Constants for Analysis Logic ---
export const MAX_REGULAR_ATTEMPTS = 3; // Max attempts for standard analysis prompt.
export const STUCK_PROCESSING_THRESHOLD_MINUTES = 15; // Time before a 'processing' job is considered stuck.

// --- Shared fetch Function with Retry and Logging ---
/**
 * Fetches a URL with retry logic for transient errors.
 * Handles exponential backoff and specific client error conditions.
 * @param url The URL to fetch.
 * @param options Standard RequestInit options.
 * @param retries Max number of retry attempts.
 * @param jobName Identifier for logging purposes, indicating the calling job.
 * @returns The fetch Response object if successful.
 * @throws Error if fetch fails after all retries or for non-retryable client errors.
 */
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
        } (URL: ${url})`
      );
      if (response.ok) return response;

      // Non-retryable client errors (4xx except 429 Too Many Requests)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        let errorBody = "[Failed to read error body]";
        try {
          errorBody = await response.text();
        } catch (_) {
          /* Silently ignore failure to read error body */
        }
        console.error(
          `[${jobName}-fetchRetry] Client error ${
            response.status
          }. Body (first 500 chars): ${errorBody.substring(
            0,
            500
          )} (URL: ${url})`
        );
        throw new Error(
          `Client error ${response.status} (URL: ${url}), will not retry.`
        );
      }

      // For server errors (5xx) or 429, log and prepare to retry
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${i + 1} failed: ${response.status} ${
          response.statusText
        } (URL: ${url})`
      );

      if (i < retries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i); // Exponential backoff
        console.log(
          `[${jobName}-fetchRetry] Waiting ${delay}ms before next retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(
          `[${jobName}-fetchRetry] Final attempt for ${url} failed with status ${response.status}`
        );
        throw new Error(
          `Failed to fetch ${url} after ${retries} attempts. Last status: ${response.status}`
        );
      }
    } catch (error) {
      // Catches network errors or errors thrown from 4xx handling above
      console.warn(
        `[${jobName}-fetchRetry] Attempt ${
          i + 1
        } error during fetch for ${url}: ${error.message}`
      );
      if (i === retries - 1) {
        console.error(
          `[${jobName}-fetchRetry] Final attempt for ${url} failed due to error.`
        );
        throw error; // Re-throw the last error to be caught by the caller
      }
      const delay = RETRY_DELAY_MS * Math.pow(2, i);
      console.log(
        `[${jobName}-fetchRetry] Waiting ${delay}ms after error before next retry...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // This line should ideally not be reached if retries > 0
  throw new Error(`Exited fetchWithRetry loop unexpectedly (URL: ${url})`);
}

// --- Helper to validate YYYY-MM-DD date strings ---
/**
 * Validates if a string is a correct 'YYYY-MM-DD' date.
 * @param dateStr The string to validate.
 * @returns True if valid, false otherwise.
 */
export function isValidDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  // Check if the date object is valid and its ISO string matches the input
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

// --- Supabase Client Initialization Helper ---
let supabaseInstance: SupabaseClient | null = null;
/**
 * Initializes and returns a singleton Supabase client instance using service role key.
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment variables.
 * @returns The SupabaseClient instance.
 * @throws Error if environment variables are missing.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const errorMsg =
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables!";
    console.error(`[SYSTEM-SETUP] ${errorMsg}`); // Prefix for system-level setup issues
    throw new Error(errorMsg);
  }

  supabaseInstance = createClient(supabaseUrl, serviceRoleKey, {
    // Recommended options for server-side (Edge Function) usage
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  console.log(
    "[SYSTEM-SETUP] Supabase client initialized (using service_role key)."
  );
  return supabaseInstance;
}

// --- Job State Update Helper ---
/**
 * Updates a job's state in the `job_state` table.
 * @param supabase Supabase client instance.
 * @param jobName The unique name of the job.
 * @param lastProcessedIdValue ID of the last item processed (null to clear, undefined to not update).
 * @param notes Optional notes for the run.
 */
export async function updateJobStateInDB(
  supabase: SupabaseClient,
  jobName: string,
  lastProcessedIdValue: string | null | undefined,
  notes?: string
): Promise<void> {
  const payload: Partial<JobStateRecord> & { job_name: string } = {
    job_name: jobName,
    last_run_at: new Date().toISOString(), // Always update last_run_at
  };
  if (lastProcessedIdValue !== undefined) {
    // Only include if a value (even null) is provided
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
      `[${jobName}] CRITICAL: Error updating job state in DB: ${error.message}`
    );
  } else {
    const LPI_display =
      payload.last_processed_id === undefined
        ? "(not updated)"
        : payload.last_processed_id === null
        ? "None (cleared)"
        : `"${payload.last_processed_id}"`; // Quote ID for clarity
    console.log(
      `[${jobName}] Job state updated successfully. Last Processed ID: ${LPI_display}. Notes: ${
        notes ?? "(no notes)"
      }`
    );
  }
}
