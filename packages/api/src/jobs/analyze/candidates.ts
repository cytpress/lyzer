// 挑選指定議程或分析佇列中可處理的紀錄
import { query } from "@/db";
import type { JsonObject } from "@/types";

export interface AgendaCandidate {
  agenda_id: string;
  category_code: number | null;
  meeting_dates: string[] | null;
  subject: string | null;
  parsed_url: string | null;
  txt_url: string | null;
  raw: JsonObject;
}

export interface AnalyzeJobResult {
  picked: number;
  completed: number;
  failed: number;
}

export async function pickCandidates(limit: number, agendaId?: string): Promise<AgendaCandidate[]> {
  if (agendaId) {
    return query<AgendaCandidate>(
      `
        select
          a.agenda_id,
          a.category_code,
          a.meeting_dates,
          a.subject,
          a.parsed_url,
          a.txt_url,
          a.raw
        from agendas a
        where a.agenda_id = $1
      `,
      [agendaId]
    );
  }

  return query<AgendaCandidate>(
    `
      select
        a.agenda_id,
        a.category_code,
        a.meeting_dates,
        a.subject,
        a.parsed_url,
        a.txt_url,
        a.raw
      from agendas a
      left join analysis_results ar on ar.agenda_id = a.agenda_id
      where a.category_code in (3, 8)
        and (a.parsed_url is not null or a.txt_url is not null)
        and (
          ar.status is null
          or ar.status = 'pending'
          or (
            ar.status = 'processing'
            and ar.updated_at < now() - interval '30 minutes'
          )
        )
      order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
      limit $1
    `,
    [limit]
  );
}
