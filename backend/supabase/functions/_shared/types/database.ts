import type {
  AnalysisStatus,
  AnalysisResultJson,
  GeminiErrorDetail,
} from "./analysis.ts";

// --- Database Record Types ---

/**
 * Stores metadata for each Gazette issue.
 * PK: gazette_id
 */
export interface GazetteRecord {
  gazette_id: string;
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  publish_date?: string | null; // 'YYYY-MM-DD'
  fetched_at?: string; // DB default
  created_at?: string; // DB default
  updated_at?: string; // DB trigger
}

/**
 * Tracks AI analysis status and results for unique content URLs.
 * PK: id (UUID)
 * Unique constraint: parsed_content_url
 */
export interface AnalyzedContentRecord {
  id: string;
  parsed_content_url: string;
  analysis_status: AnalysisStatus;
  analysis_result?: AnalysisResultJson | GeminiErrorDetail | null; // Stores success JSON or error details.
  committee_name?: string[] | null;
  analyzed_at?: string | null; // Timestamp of successful completion.
  analysis_attempts: number; // Counter for regular analysis.
  processing_started_at?: string | null; // Timestamp when processing began (for detecting stuck jobs).
  error_message?: string | null; // Brief error from last failed attempt.
  last_error_type?: string | null; // Categorical type of last error.
  created_at: string; // DB default
  updated_at: string; // DB trigger
}

/**
 * Stores metadata for each agenda item within a Gazette.
 * `parsed_content_url` can be duplicated here.
 * PK: agenda_id
 * FK: gazette_id references gazettes(gazette_id)
 */
export interface GazetteAgendaRecord {
  agenda_id: string;
  gazette_id: string;
  volume?: number | null;
  issue?: number | null;
  booklet?: number | null;
  session?: number | null; // Legislative Yuan term.
  term?: number | null; // Session period within the term.
  meeting_dates?: string[] | null;
  subject?: string | null;
  category_code?: number | null; // Numeric code for agenda type.
  start_page?: number | null;
  end_page?: number | null;
  parsed_content_url?: string | null; // URL to plain text content for AI analysis.
  analyzed_content_id: string | null;
  official_page_url?: string | null;
  official_pdf_url?: string | null;
  fetched_at?: string; // DB default
  created_at?: string; // DB default
  updated_at?: string; // DB trigger
}

/**
 * Tracks execution state of background jobs.
 * PK: job_name
 */
export interface JobStateRecord {
  job_name: string;
  last_processed_id?: string | null; // e.g., last gazette_id for fetcher job.
  last_run_at?: string | null;
  notes?: string | null; // Summary or errors from last run.
  created_at: string; // DB default
  updated_at: string; // DB trigger
}
