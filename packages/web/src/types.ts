export interface SpeakerDetail {
  speaker_name?: string | null;
  speaker_viewpoint?: string[] | null;
}

export interface AnalysisAgendaItem {
  item_title?: string | null;
  title?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  core_issue?: string[] | null;
  controversy?: string[] | null;
  legislator_speakers?: SpeakerDetail[] | null;
  respondent_speakers?: SpeakerDetail[] | null;
  result_status_next?: string[] | null;
}

export interface AnalysisJson {
  summary_title?: string;
  committee_name?: string[] | string | null;
  overall_summary_sentence?: string;
  agenda_items?: AnalysisAgendaItem[] | null;
  legislator_speakers?: string[];
  respondent_speakers?: string[];
  main_topics?: string[];
  result_and_next_steps?: string[];
  neutral_context?: string[];
  [key: string]: unknown;
}

export interface HomepageAgenda {
  agendaId: string;
  gazetteId: string;
  meetingDates: string[];
  meetingDate: string | null;
  subject: string | null;
  committee: string | null;
  summaryTitle: string;
  overallSummary: string;
  agendaItems: string[];
  legislators: string[];
  respondents: string[];
  resultAndNextSteps: string[];
  analyzedAt: string | null;
}

export interface AgendaDetail {
  agendaId: string;
  gazetteId: string;
  volume: number | null;
  issue: number | null;
  booklet: number | null;
  publishDate: string | null;
  meetingDates: string[];
  subject: string | null;
  categoryCode: number | null;
  parsedUrl: string | null;
  txtUrl: string | null;
  officialPageUrl: string | null;
  officialPdfUrl: string | null;
  analysis: AnalysisJson;
  analyzedAt: string | null;
}

export interface LegislatorTimelineEvent {
  agendaId: string;
  title: string;
  meetingDate: string;
  committee: string;
  viewpoints: string[];
}

export interface LegislatorSpeechStat {
  name: string;
  fullName: string;
  speechCount: number;
  lastSpeechDate: string;
  lastAgendaId: string;
  lastAgendaTitle: string;
  timeline: LegislatorTimelineEvent[];
}
