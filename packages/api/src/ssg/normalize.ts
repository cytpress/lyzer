// 將資料庫欄位和 JSON 分析結果整理成網站讀取模型
import type { AgendaDetail, AgendaLawLink, HomepageAgenda, JsonObject } from "@/types";

export interface HomepageRow {
  agenda_id: string;
  gazette_id: string;
  meeting_dates: string[] | null;
  subject: string | null;
  analysis_json: JsonObject;
  analyzed_at: string | null;
}

export interface DetailRow extends HomepageRow {
  volume: number | null;
  issue: number | null;
  booklet: number | null;
  publish_date: string | null;
  category_code: number | null;
  parsed_url: string | null;
  txt_url: string | null;
  official_page_url: string | null;
  official_pdf_url: string | null;
  related_laws: unknown;
}

export interface AgendaDetailsPage {
  items: AgendaDetail[];
  nextCursor: string | null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

function normalizeDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeDate).filter((item): item is string => Boolean(item));
}

export function asCommittee(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    const names = value.filter((item): item is string => typeof item === "string" && item.length > 0);
    return names.length > 0 ? names.join("、") : null;
  }
  return null;
}

function relatedLaws(value: unknown): AgendaLawLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const law = item as JsonObject;
    const lawId = asString(law.lawId);
    if (!lawId) return [];
    return [{ lawId, lawName: asString(law.lawName) }];
  });
}

function agendaItems(analysis: JsonObject): string[] {
  const items = analysis.agenda_items;
  if (!Array.isArray(items)) return [];
  // 匯入的舊版分析有些議程項目仍以純字串保存
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const json = item as JsonObject;
        return asString(json.item_title) ?? asString(json.title);
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function nextSteps(analysis: JsonObject): string[] {
  const topLevel = asStringArray(analysis.result_and_next_steps);
  if (topLevel.length > 0) return topLevel;

  // 舊版資料將後續事項放在各議程項目內，沒有新版頂層欄位時再回頭彙整
  const items = analysis.agenda_items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return asStringArray((item as JsonObject).result_status_next);
  });
}

function speakerNames(analysis: JsonObject, key: "legislator_speakers" | "respondent_speakers"): string[] {
  const topLevel = asStringArray(analysis[key]);
  if (topLevel.length > 0) return topLevel;

  // v1 匯入資料通常只有 agenda_items 內的發言者清單，因此由各議程項目合併並去重
  const items = analysis.agenda_items;
  if (!Array.isArray(items)) return [];

  const names = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const speakers = (item as JsonObject)[key];
    if (!Array.isArray(speakers)) return [];
    return speakers
      .map((speaker) => {
        if (typeof speaker === "string") return speaker;
        if (speaker && typeof speaker === "object") return asString((speaker as JsonObject).speaker_name);
        return null;
      })
      .filter((name): name is string => Boolean(name));
  });

  return Array.from(new Set(names));
}

export function toHomepageAgenda(row: HomepageRow): HomepageAgenda {
  const analysis = row.analysis_json ?? {};
  const meetingDates = normalizeDates(row.meeting_dates);

  return {
    agendaId: row.agenda_id,
    gazetteId: row.gazette_id,
    meetingDates,
    meetingDate: meetingDates[0] ?? null,
    subject: row.subject,
    committee: asCommittee(analysis.committee_name),
    documentType: asString(analysis.document_type),
    summaryTitle: asString(analysis.summary_title) ?? row.subject ?? row.agenda_id,
    overallSummary: asString(analysis.overall_summary_sentence) ?? "",
    agendaItems: agendaItems(analysis),
    legislators: speakerNames(analysis, "legislator_speakers"),
    respondents: speakerNames(analysis, "respondent_speakers"),
    resultAndNextSteps: nextSteps(analysis),
    analyzedAt: row.analyzed_at,
  };
}

export function toAgendaDetail(row: DetailRow): AgendaDetail {
  return {
    agendaId: row.agenda_id,
    gazetteId: row.gazette_id,
    volume: row.volume,
    issue: row.issue,
    booklet: row.booklet,
    publishDate: normalizeDate(row.publish_date),
    meetingDates: normalizeDates(row.meeting_dates),
    subject: row.subject,
    categoryCode: row.category_code,
    parsedUrl: row.parsed_url,
    txtUrl: row.txt_url,
    officialPageUrl: row.official_page_url,
    officialPdfUrl: row.official_pdf_url,
    relatedLaws: relatedLaws(row.related_laws),
    analysis: row.analysis_json ?? {},
    analyzedAt: row.analyzed_at,
  };
}
