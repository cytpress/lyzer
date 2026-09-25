// 匯出供 API route 使用的靜態網站讀取功能
export { getAgendaDetail, getAgendaDetailsPage, getAgendaIds, getCommittees, getHomepageAgendas } from "@/ssg/queries";
export { getLegislatorStats } from "@/ssg/legislators";
export type { AgendaDetailsPage } from "@/ssg/normalize";
