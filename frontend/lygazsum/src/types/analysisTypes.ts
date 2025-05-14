// should be the same as backend/supabase/functions/_shared/types/analysis.ts

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

