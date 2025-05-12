// --- Analysis Types ---

/** Possible states for content analysis. */
export type AnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped"
  | "needs_shortened_retry"
  | "processing_shortened"
  | "partially_completed";

/** A speaker and their viewpoints. */
export interface KeySpeaker {
  speaker_name: string | null;
  speaker_viewpoint: string[] | null;
}

/** An analyzed agenda item. */
export interface AgendaItem {
  item_title: string | null;
  core_issue: string[] | null;
  controversy: string[] | null;
  key_speakers: KeySpeaker[] | null;
  result_status_next: string[] | null;
}

/** Structure of a successful AI analysis JSON result. */
export interface AnalysisResultJson {
  summary_title: string;
  overall_summary_sentence: string;
  committee_name: string | null;
  agenda_items: AgendaItem[] | null;
}

/** Basic analysis error structure. */
export interface AnalysisErrorJson {
  error: string;
  details?: string;
}

/** Detailed error from Gemini API or parsing. */
export interface GeminiErrorDetail extends AnalysisErrorJson {
  type?: string; // e.g., "MAX_TOKENS", "SAFETY".
  rawOutput?: string; // Raw AI response, if relevant.
  parsedResult?: AnalysisResultJson; // Partially parsed data on error.
}
