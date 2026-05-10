import { config } from "../config.js";
import { loadAgendaText } from "../content.js";
import { query } from "../db.js";
import { analyzeWithGemini } from "../gemini.js";
import type { JsonObject } from "../types.js";

interface AgendaCandidate {
  agenda_id: string;
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

async function pickCandidates(limit: number): Promise<AgendaCandidate[]> {
  return query<AgendaCandidate>(
    `
      select
        a.agenda_id,
        a.meeting_dates,
        a.subject,
        a.parsed_url,
        a.txt_url,
        a.raw
      from agendas a
      left join analysis_results ar on ar.agenda_id = a.agenda_id
      where a.category_code = 3
        and (ar.status is null or ar.status = 'pending')
      order by coalesce(a.meeting_dates[1], date '1900-01-01') desc, a.agenda_id desc
      limit $1
    `,
    [limit],
  );
}

async function markProcessing(agendaId: string): Promise<void> {
  await query(
    `
      insert into analysis_results (agenda_id, status, error_message, updated_at)
      values ($1, 'processing', null, now())
      on conflict (agenda_id) do update set
        status = 'processing',
        error_message = null,
        updated_at = now()
    `,
    [agendaId],
  );
}

async function markCompleted(agendaId: string, analysis: JsonObject): Promise<void> {
  await query(
    `
      update analysis_results
      set status = 'completed',
          analysis_json = $2::jsonb,
          analyzed_at = now(),
          error_message = null,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, JSON.stringify(analysis)],
  );
}

async function markFailed(agendaId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await query(
    `
      update analysis_results
      set status = 'failed',
          error_message = $2,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, message.slice(0, 2000)],
  );
}

export async function analyzePendingAgendas(options: { limit?: number } = {}): Promise<AnalyzeJobResult> {
  const candidates = await pickCandidates(options.limit ?? config.analyzeBatchSize);
  const result: AnalyzeJobResult = {
    picked: candidates.length,
    completed: 0,
    failed: 0,
  };

  for (const agenda of candidates) {
    await markProcessing(agenda.agenda_id);
    try {
      const sourceText = await loadAgendaText(agenda);
      const analysis = await analyzeWithGemini({
        agendaId: agenda.agenda_id,
        subject: agenda.subject,
        meetingDates: agenda.meeting_dates ?? [],
        sourceText,
      });
      await markCompleted(agenda.agenda_id, analysis);
      result.completed += 1;
    } catch (error) {
      console.error(error);
      await markFailed(agenda.agenda_id, error);
      result.failed += 1;
    }
  }

  return result;
}
