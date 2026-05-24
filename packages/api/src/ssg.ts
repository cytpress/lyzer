import { query } from "./db.js";
import type {
  AgendaDetail,
  HomepageAgenda,
  JsonObject,
  LegislatorSpeechStat,
  LegislatorTimelineEvent,
} from "./types.js";

interface HomepageRow {
  agenda_id: string;
  gazette_id: string;
  meeting_dates: string[] | null;
  subject: string | null;
  analysis_json: JsonObject;
  analyzed_at: string | null;
}

interface DetailRow extends HomepageRow {
  volume: number | null;
  issue: number | null;
  booklet: number | null;
  publish_date: string | null;
  category_code: number | null;
  parsed_url: string | null;
  txt_url: string | null;
  official_page_url: string | null;
  official_pdf_url: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

function normalizeDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeDate).filter((item): item is string => Boolean(item));
}

function asCommittee(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    const names = value.filter((item): item is string => typeof item === "string" && item.length > 0);
    return names.length > 0 ? names.join("、") : null;
  }
  return null;
}

function agendaItems(analysis: JsonObject): string[] {
  const items = analysis.agenda_items;
  if (!Array.isArray(items)) return [];
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

function toHomepageAgenda(row: HomepageRow): HomepageAgenda {
  const analysis = row.analysis_json ?? {};
  const meetingDates = normalizeDates(row.meeting_dates);

  return {
    agendaId: row.agenda_id,
    gazetteId: row.gazette_id,
    meetingDates,
    meetingDate: meetingDates[0] ?? null,
    subject: row.subject,
    committee: asCommittee(analysis.committee_name),
    summaryTitle: asString(analysis.summary_title) ?? row.subject ?? row.agenda_id,
    overallSummary: asString(analysis.overall_summary_sentence) ?? "",
    agendaItems: agendaItems(analysis),
    legislators: speakerNames(analysis, "legislator_speakers"),
    respondents: speakerNames(analysis, "respondent_speakers"),
    resultAndNextSteps: nextSteps(analysis),
    analyzedAt: row.analyzed_at,
  };
}

export async function getHomepageAgendas(): Promise<HomepageAgenda[]> {
  const rows = await query<HomepageRow>(`
    select
      a.agenda_id,
      a.gazette_id,
      a.meeting_dates,
      a.subject,
      ar.analysis_json,
      ar.analyzed_at
    from agendas a
    join analysis_results ar on ar.agenda_id = a.agenda_id
    where ar.status = 'completed'
    order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
  `);

  return rows.map(toHomepageAgenda);
}

export async function getAgendaIds(): Promise<string[]> {
  const rows = await query<{ agenda_id: string }>(`
    select a.agenda_id
    from agendas a
    join analysis_results ar on ar.agenda_id = a.agenda_id
    where ar.status = 'completed'
    order by a.agenda_id desc
  `);

  return rows.map((row) => row.agenda_id);
}

export async function getCommittees(): Promise<string[]> {
  const agendas = await getHomepageAgendas();
  return Array.from(
    new Set(agendas.map((agenda) => agenda.committee).filter((item): item is string => Boolean(item)))
  ).sort((a, b) => a.localeCompare(b, "zh-Hant-TW"));
}

export async function getAgendaDetail(agendaId: string): Promise<AgendaDetail | null> {
  const rows = await query<DetailRow>(
    `
      select
        a.agenda_id,
        a.gazette_id,
        a.meeting_dates,
        a.subject,
        a.category_code,
        a.parsed_url,
        a.txt_url,
        a.official_page_url,
        a.official_pdf_url,
        g.volume,
        g.issue,
        g.booklet,
        g.publish_date,
        ar.analysis_json,
        ar.analyzed_at
      from agendas a
      join gazettes g on g.gazette_id = a.gazette_id
      join analysis_results ar on ar.agenda_id = a.agenda_id
      where a.agenda_id = $1
        and ar.status = 'completed'
      limit 1
    `,
    [agendaId]
  );

  const row = rows[0];
  if (!row) return null;

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
    analysis: row.analysis_json ?? {},
    analyzedAt: row.analyzed_at,
  };
}

export async function getLegislatorStats(): Promise<LegislatorSpeechStat[]> {
  const rows = await query<{
    agenda_id: string;
    meeting_dates: string[] | null;
    publish_date: string | null;
    subject: string | null;
    analysis_json: JsonObject;
  }>(`
    select
      a.agenda_id,
      a.meeting_dates,
      g.publish_date,
      a.subject,
      ar.analysis_json
    from agendas a
    join gazettes g on g.gazette_id = a.gazette_id
    join analysis_results ar on ar.agenda_id = a.agenda_id
    where ar.status = 'completed'
    order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
  `);

  const legislatorMap = new Map<string, LegislatorSpeechStat>();

  for (const row of rows) {
    const analysis = row.analysis_json ?? {};
    const agendaItems = Array.isArray(analysis.agenda_items) ? analysis.agenda_items : [];
    const meetingDate = normalizeDate(row.meeting_dates?.[0] ?? row.publish_date) ?? "無日期";
    const committee = asCommittee(analysis.committee_name) ?? "委員會";
    const title = asString(analysis.summary_title) ?? row.subject ?? row.agenda_id;

    for (const item of agendaItems) {
      if (!item || typeof item !== "object") continue;
      const speakers = (item as JsonObject).legislator_speakers;
      if (!Array.isArray(speakers)) continue;

      for (const speaker of speakers) {
        if (!speaker || typeof speaker !== "object") continue;
        const speakerObj = speaker as JsonObject;
        const rawName = asString(speakerObj.speaker_name) ?? "";
        if (!rawName) continue;

        // 統一格式化：完全去除 "立法委員"、"委員"、"立法" 及多餘空白
        const cleanName = rawName
          .replace(/\s*(立法委員|委員|立法)\s*/g, "")
          .replace(/\s+/g, "")
          .trim();
        if (!cleanName) continue;

        const viewpoints = Array.isArray(speakerObj.speaker_viewpoint)
          ? speakerObj.speaker_viewpoint.filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];

        const nameKey = cleanName;
        const existing = legislatorMap.get(nameKey);

        const timelineEvent: LegislatorTimelineEvent = {
          agendaId: row.agenda_id,
          title,
          meetingDate,
          committee,
          viewpoints,
        };

        if (existing) {
          existing.speechCount += 1;
          existing.timeline.push(timelineEvent);
          if (meetingDate > existing.lastSpeechDate) {
            existing.lastSpeechDate = meetingDate;
            existing.lastAgendaId = row.agenda_id;
            existing.lastAgendaTitle = title;
          }
        } else {
          legislatorMap.set(nameKey, {
            name: cleanName,
            fullName: `${cleanName} 委員`,
            speechCount: 1,
            lastSpeechDate: meetingDate,
            lastAgendaId: row.agenda_id,
            lastAgendaTitle: title,
            timeline: [timelineEvent],
          });
        }
      }
    }
  }

  return Array.from(legislatorMap.values());
}
