import type { PoolClient } from "pg";
import { config } from "../config.js";
import { listGazetteAgendas, listGazettes } from "../lyapiClient.js";
import { withClient } from "../db.js";
import type { NormalizedAgenda, NormalizedGazette } from "../types.js";

export interface FetchJobResult {
  gazettes: number;
  agendas: number;
  pendingAnalyses: number;
}

async function upsertGazette(client: PoolClient, gazette: NormalizedGazette): Promise<void> {
  await client.query(
    `
      insert into gazettes (
        gazette_id, volume, issue, booklet, publish_date, raw, fetched_at
      ) values ($1, $2, $3, $4, $5, $6::jsonb, now())
      on conflict (gazette_id) do update set
        volume = excluded.volume,
        issue = excluded.issue,
        booklet = excluded.booklet,
        publish_date = excluded.publish_date,
        raw = excluded.raw,
        fetched_at = now()
    `,
    [
      gazette.gazetteId,
      gazette.volume,
      gazette.issue,
      gazette.booklet,
      gazette.publishDate,
      JSON.stringify(gazette.raw),
    ]
  );
}

async function upsertAgenda(client: PoolClient, agenda: NormalizedAgenda): Promise<void> {
  await client.query(
    `
      insert into agendas (
        agenda_id,
        gazette_id,
        meeting_dates,
        subject,
        category_code,
        parsed_url,
        txt_url,
        official_page_url,
        official_pdf_url,
        raw,
        fetched_at
      ) values ($1, $2, $3::date[], $4, $5, $6, $7, $8, $9, $10::jsonb, now())
      on conflict (agenda_id) do update set
        gazette_id = excluded.gazette_id,
        meeting_dates = excluded.meeting_dates,
        subject = excluded.subject,
        category_code = excluded.category_code,
        parsed_url = excluded.parsed_url,
        txt_url = excluded.txt_url,
        official_page_url = excluded.official_page_url,
        official_pdf_url = excluded.official_pdf_url,
        raw = excluded.raw,
        fetched_at = now()
    `,
    [
      agenda.agendaId,
      agenda.gazetteId,
      agenda.meetingDates,
      agenda.subject,
      agenda.categoryCode,
      agenda.parsedUrl,
      agenda.txtUrl,
      agenda.officialPageUrl,
      agenda.officialPdfUrl,
      JSON.stringify(agenda.raw),
    ]
  );
}

async function ensurePendingAnalysis(client: PoolClient, agenda: NormalizedAgenda): Promise<boolean> {
  // 3 為委員會發言紀錄，8 為黨團協商紀錄
  if (agenda.categoryCode !== 3 && agenda.categoryCode !== 8) return false;

  const result = await client.query(
    `
      insert into analysis_results (agenda_id, status, updated_at)
      values ($1, 'pending', now())
      on conflict (agenda_id) do nothing
    `,
    [agenda.agendaId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function fetchNewGazettes(options: { pages?: number; startPage?: number } = {}): Promise<FetchJobResult> {
  const pages = options.pages ?? 1;
  const startPage = options.startPage ?? 1;
  const result: FetchJobResult = {
    gazettes: 0,
    agendas: 0,
    pendingAnalyses: 0,
  };

  const endPage = startPage + pages - 1;
  for (let page = startPage; page <= endPage; page += 1) {
    const gazettes = await listGazettes(page, config.lyapiGazetteLimit);

    for (const gazette of gazettes) {
      const agendas = await listGazetteAgendas(gazette.gazetteId, config.lyapiAgendaLimit);

      await withClient(async (client) => {
        await client.query("begin");
        try {
          await upsertGazette(client, gazette);
          result.gazettes += 1;

          for (const agenda of agendas) {
            await upsertAgenda(client, agenda);
            result.agendas += 1;
            if (await ensurePendingAnalysis(client, agenda)) {
              result.pendingAnalyses += 1;
            }
          }

          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    }
  }

  return result;
}
