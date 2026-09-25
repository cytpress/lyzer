// 定義首頁篩選目錄精簡資料格式與轉換方式
import type { HomepageAgenda } from "@/types";

export const AGENDA_CATALOG_CHUNK_SIZE = 1000;

// 首頁篩選只帶卡片會顯示的欄位，完整摘要留在詳細頁避免重複傳輸
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
