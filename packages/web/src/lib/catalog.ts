import type { HomepageAgenda } from "../types";

export const AGENDA_CATALOG_CHUNK_SIZE = 1000;

export type AgendaCatalogItem = Pick<
  HomepageAgenda,
  | "agendaId"
  | "gazetteId"
  | "meetingDate"
  | "subject"
  | "committee"
  | "documentType"
  | "summaryTitle"
  | "overallSummary"
>;

export function toAgendaCatalogItem(agenda: HomepageAgenda): AgendaCatalogItem {
  return {
    agendaId: agenda.agendaId,
    gazetteId: agenda.gazetteId,
    meetingDate: agenda.meetingDate,
    subject: agenda.subject,
    committee: agenda.committee,
    documentType: agenda.documentType,
    summaryTitle: agenda.summaryTitle,
    overallSummary: agenda.overallSummary,
  };
}
