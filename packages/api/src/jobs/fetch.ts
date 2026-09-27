// 同步新公報與議程資料並更新資料庫
import type { PoolClient } from "pg";
import { config } from "@/config";
import { getCommitteeMeetingsForAgendas, listGazetteAgendas, listGazettes } from "@/lyapiClient";
import { withClient } from "@/db";
import type { NormalizedAgenda, NormalizedGazette } from "@/types";

export interface FetchJobResult {
  gazettes: number;
  agendas: number;
  pendingAnalyses: number;
  agendaLawRecords: number;
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

async function upsertAgendas(client: PoolClient, agendas: NormalizedAgenda[]): Promise<void> {
  if (agendas.length === 0) return;

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
      )
      select
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
        now()
      from jsonb_to_recordset($1::jsonb) as agenda(
        agenda_id text,
        gazette_id text,
        meeting_dates date[],
        subject text,
        category_code integer,
        parsed_url text,
        txt_url text,
        official_page_url text,
        official_pdf_url text,
        raw jsonb
      )
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
      JSON.stringify(
        agendas.map((agenda) => ({
          agenda_id: agenda.agendaId,
          gazette_id: agenda.gazetteId,
          meeting_dates: agenda.meetingDates,
          subject: agenda.subject,
          category_code: agenda.categoryCode,
          parsed_url: agenda.parsedUrl,
          txt_url: agenda.txtUrl,
          official_page_url: agenda.officialPageUrl,
          official_pdf_url: agenda.officialPdfUrl,
          raw: agenda.raw,
        }))
      ),
    ]
  );
}

async function ensurePendingAnalyses(client: PoolClient, agendas: NormalizedAgenda[]): Promise<number> {
  // 3 為委員會發言紀錄，8 為黨團協商紀錄
  const agendaIds = agendas
    .filter((agenda) => agenda.categoryCode === 3 || agenda.categoryCode === 8)
    .map((agenda) => agenda.agendaId);
  if (agendaIds.length === 0) return 0;

  const result = await client.query(
    `
      insert into analysis_results (agenda_id, status, updated_at)
      select distinct agenda_id, 'pending', now()
      from jsonb_to_recordset($1::jsonb) as agenda(agenda_id text)
      on conflict (agenda_id) do nothing
    `,
    [JSON.stringify(agendaIds.map((agendaId) => ({ agenda_id: agendaId })))]
  );

  return result.rowCount ?? 0;
}

export async function fetchNewGazettes(options: { pages?: number; startPage?: number } = {}): Promise<FetchJobResult> {
  const pages = options.pages ?? 1;
  const startPage = options.startPage ?? 1;
  const result: FetchJobResult = {
    gazettes: 0,
    agendas: 0,
    pendingAnalyses: 0,
    agendaLawRecords: 0,
  };
  const fetchedAgendas = new Map<string, NormalizedAgenda>();

  const endPage = startPage + pages - 1;
  for (let page = startPage; page <= endPage; page += 1) {
    const gazettes = await listGazettes(page, config.lyapiGazetteLimit);

    for (const gazette of gazettes) {
      const agendas = await listGazetteAgendas(gazette.gazetteId, config.lyapiAgendaLimit);
      const uniqueAgendas = Array.from(new Map(agendas.map((agenda) => [agenda.agendaId, agenda])).values());

      await withClient(async (client) => {
        // 以單一本公報為交易單位，避免公報已更新但議程只寫入一部分
        await client.query("begin");
        try {
          await upsertGazette(client, gazette);
          await upsertAgendas(client, uniqueAgendas);
          const pendingAnalyses = await ensurePendingAnalyses(client, uniqueAgendas);

          await client.query("commit");
          result.gazettes += 1;
          result.agendas += uniqueAgendas.length;
          result.pendingAnalyses += pendingAnalyses;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });

      for (const agenda of uniqueAgendas) fetchedAgendas.set(agenda.agendaId, agenda);
    }
  }

  const agendasForLawLookup = Array.from(fetchedAgendas.values(), (agenda) => ({
    agendaId: agenda.agendaId,
    categoryCode: agenda.categoryCode,
    meetingDates: agenda.meetingDates,
  }));
  const lawsByAgenda = await getCommitteeMeetingsForAgendas(agendasForLawLookup);

  if (lawsByAgenda.size > 0) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        for (const [agendaId, laws] of lawsByAgenda) {
          await client.query(
            `
              update agendas
              set related_laws = $2::jsonb
              where agenda_id = $1
            `,
            [agendaId, JSON.stringify(laws)]
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    result.agendaLawRecords = lawsByAgenda.size;
  }

  return result;
}
