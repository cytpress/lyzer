// 將分析工作狀態與結果更新至資料庫
import { query } from "@/db";
import type { JsonObject } from "@/types";

export async function markProcessing(agendaId: string): Promise<void> {
  await query(
    `
      insert into analysis_results (agenda_id, status, error_message, updated_at)
      values ($1, 'processing', null, now())
      on conflict (agenda_id) do update set
        status = 'processing',
        analysis_json = null,
        committee_names = null,
        document_type = null,
        is_public = null,
        analyzed_at = null,
        error_message = null,
        updated_at = now()
    `,
    [agendaId]
  );
}

export async function markCompleted(agendaId: string, analysis: JsonObject): Promise<void> {
  const committeeNames = Array.isArray(analysis.committee_name)
    ? analysis.committee_name.filter((name): name is string => typeof name === "string")
    : null;
  const documentType = typeof analysis.document_type === "string" ? analysis.document_type : null;
  const isPublic = typeof analysis.is_public === "boolean" ? analysis.is_public : null;

  await query(
    `
      update analysis_results
      set status = 'completed',
          analysis_json = $2::jsonb,
          committee_names = $3::text[],
          document_type = $4,
          is_public = $5,
          analyzed_at = now(),
          error_message = null,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, JSON.stringify(analysis), committeeNames, documentType, isPublic]
  );
}

export async function markFailed(agendaId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await query(
    `
      update analysis_results
      set status = 'failed',
          analysis_json = null,
          committee_names = null,
          document_type = null,
          is_public = null,
          error_message = $2,
          analyzed_at = now(),
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId, message.slice(0, 2000)]
  );
}

export async function markPending(agendaId: string): Promise<void> {
  await query(
    `
      update analysis_results
      set status = 'pending',
          error_message = null,
          updated_at = now()
      where agenda_id = $1
    `,
    [agendaId]
  );
}
