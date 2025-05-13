// backend/supabase/functions/_shared/types/analysis.ts

/**
 * Details of an error encountered during analysis or processing.
 */
export interface GeminiErrorDetail {
  error: string; // Main error message.
  type: // Categorical error type.
  | "API_CALL_OR_PARSE_ERROR"
    | "JSON_PARSE_ERROR_WITH_SCHEMA"
    | "SCHEMA_ERROR_OR_OTHER"
    | "MAX_TOKENS"
    | "SAFETY"
    | "NETWORK_ERROR"
    | "AUTH_ERROR"
    | "TIMEOUT_ERROR"
    | "HTTP_ERROR"
    | "QUOTA_EXCEEDED"
    | "INVALID_ARGUMENT"
    | "GOOGLE_AI_ERROR"
    | "MALFORMED_RESPONSE"
    | "EMPTY_RESPONSE_PART"
    | "INVALID_STRUCTURE_POST_SCHEMA"
    | "UNKNOWN_GEMINI_ERROR"
    | "PIPELINE_ERROR"
    | "FETCH_ERROR"
    | "SKIPPED_BY_CATEGORY_FILTER"
    | "STUCK_RESCUED"
    | "STUCK_REQUEUED_PENDING"
    | "STUCK_MAX_ATTEMPTS_FAILED"
    | "STUCK_OBSOLETE_STATE_FAILED"
    | "INCONSISTENT_STATE"
    | "UNKNOWN_ERROR_FINAL";
  rawOutput?: string; // Optional: Raw text from Gemini for debugging.
  parsedResult?: unknown; // Optional: Problematic parsed JSON for debugging.
}

/**
 * Structure for a single speaker's details.
 */
export interface SpeakerDetail {
  speaker_name: string | null; // Speaker's name and title/affiliation.
  speaker_viewpoint: string[] | null; // Array of speaker's key viewpoints.
}

/**
 * Structure for the analysis of a single agenda item.
 */
export interface AgendaItemAnalysis {
  item_title: string | null; // Title of the agenda item.
  core_issue: string[] | null; // Core issues or discussion points.
  controversy: string[] | null; // Main points of contention.
  legislator_speakers: SpeakerDetail[] | null; // Legislators'.
  respondent_speakers: SpeakerDetail[] | null; // Officials'/respondents'.
  result_status_next: string[] | null; // Outcomes or next steps.
}

/**
 * Overall JSON structure expected from Gemini AI analysis.
 */
export interface AnalysisResultJson {
  summary_title: string; // Overall summary title.
  overall_summary_sentence: string; // Comprehensive summary sentence.
  committee_name: string[] | null; // Array of committee names.
  agenda_items: AgendaItemAnalysis[] | null; // Array of analyzed agenda items.
}

/**
 * Possible statuses of an analysis task.
 */
export type AnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";
