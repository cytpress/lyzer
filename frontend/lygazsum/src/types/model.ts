import { AnalysisResultJson } from "./analysisTypes";

export interface HomePageGazetteItem {
  id: string;
  committee_names: string[];
  summary_title: string;
  overall_summary_sentence: string;
  publish_date: string;
}

export interface DetailedGazetteItem {
  id: string;
  parsed_content_url: string;
  analysis_result: AnalysisResultJson;
  committee_names: string[];
  analysis_status: string;

  agenda_id: string;
  agenda_subject: string;
  agenda_meeting_dates: string[];
  agenda_start_page: number;
  agenda_end_page: number;
  agenda_official_page_url: string;
  agenda_official_pdf_url: string;

  parent_gazette_id: string;
  gazette_volume: number;
  gazette_issue: number;
  gazette_booklet: number;
  gazette_publish_date: string;
}
