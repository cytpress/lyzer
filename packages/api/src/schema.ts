import { pool } from "./db.js";

export async function migrate(): Promise<void> {
  await pool.query(`
    create table if not exists gazettes (
      gazette_id text primary key,
      volume integer,
      issue integer,
      booklet integer,
      publish_date date,
      raw jsonb not null,
      fetched_at timestamptz not null default now()
    );

    create table if not exists agendas (
      agenda_id text primary key,
      gazette_id text not null references gazettes(gazette_id) on delete cascade,
      meeting_dates date[],
      subject text,
      category_code integer,
      parsed_url text,
      txt_url text,
      official_page_url text,
      official_pdf_url text,
      raw jsonb not null,
      fetched_at timestamptz not null default now()
    );

    create table if not exists analysis_results (
      agenda_id text primary key references agendas(agenda_id) on delete cascade,
      status text not null check (status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
      analysis_json jsonb,
      analyzed_at timestamptz,
      error_message text,
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_agendas_gazette_id on agendas(gazette_id);
    create index if not exists idx_agendas_category_code on agendas(category_code);
    create index if not exists idx_agendas_meeting_dates on agendas using gin(meeting_dates);
    create index if not exists idx_analysis_results_status on analysis_results(status);
    create index if not exists idx_gazettes_publish_date on gazettes(publish_date desc);

    create table if not exists job_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
}
