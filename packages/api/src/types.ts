export type JsonObject = Record<string, unknown>;

export interface NormalizedGazette {
  gazetteId: string;
  volume: number | null;
  issue: number | null;
  booklet: number | null;
  publishDate: string | null;
  raw: JsonObject;
}

export interface ProcessedUrl {
  type: string;
  no: number | null;
  url: string;
}

export interface NormalizedAgenda {
  agendaId: string;
  gazetteId: string;
  meetingDates: string[];
  subject: string | null;
  categoryCode: number | null;
  parsedUrl: string | null;
  txtUrl: string | null;
  officialPageUrl: string | null;
  officialPdfUrl: string | null;
  processedUrls: ProcessedUrl[];
  raw: JsonObject;
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
  analysis: JsonObject;
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
