// 提供公開靜態網站建置所需的資料庫查詢
import { query } from "@/db";
import { toAgendaDetail, toHomepageAgenda } from "@/ssg/normalize";
import type { AgendaDetail, HomepageAgenda } from "@/types";
import type { AgendaDetailsPage, DetailRow, HomepageRow } from "@/ssg/normalize";

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
      and coalesce(ar.is_public, true)
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
      and coalesce(ar.is_public, true)
    order by a.agenda_id desc
  `);

  return rows.map((row) => row.agenda_id);
}

export async function getAgendaDetailsPage(
  options: {
    cursor?: string;
    limit?: number;
  } = {}
): Promise<AgendaDetailsPage> {
  const cursor = options.cursor?.trim() || null;
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200), 1), 250);
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
      where ar.status = 'completed'
        and coalesce(ar.is_public, true)
        and ($1::text is null or a.agenda_id < $1)
      order by a.agenda_id desc
      limit $2
    `,
    [cursor, limit]
  );

  return {
    items: rows.map(toAgendaDetail),
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.agenda_id ?? null) : null,
  };
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
        and coalesce(ar.is_public, true)
      limit 1
    `,
    [agendaId]
  );

  const row = rows[0];
  return row ? toAgendaDetail(row) : null;
}
