-- ======================================================================
-- Supabase App Schema Initialization Script
-- Version: 2.2 (committee_name as TEXT[], simplified analyzed_contents)
-- Description: Creates tables for gazettes, gazette_agendas,
--              analyzed_contents, and job_state.
--              `analyzed_contents.committee_name` is TEXT ARRAY.
-- WARNING: This script is designed for a fresh setup.
--          If you have existing tables with the same names,
--          they WILL BE DROPPED. BACKUP YOUR DATA.
-- ======================================================================
-- ------------ Enable Necessary Extensions ------------
CREATE EXTENSION IF NOT EXISTS "plpgsql"
WITH
    SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto"
WITH
    SCHEMA "extensions";

-- ------------ Set Schema and Timeouts ------------
SET
    statement_timeout = 0;

SET
    lock_timeout = 0;

SET
    idle_in_transaction_session_timeout = 0;

SET
    client_encoding = 'UTF8';

SET
    standard_conforming_strings = on;

SELECT
    pg_catalog.set_config ('search_path', 'public', false);

SET
    check_function_bodies = false;

SET
    xmloption = content;

SET
    client_min_messages = warning;

SET
    row_security = off;

-- ------------ Generic updated_at Trigger Function ------------
CREATE
OR REPLACE FUNCTION public.trigger_set_timestamp () RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.trigger_set_timestamp () IS 'Automatically updates the updated_at column to the current timestamp before an UPDATE operation.';

-- ======================================================================
-- Table Definitions
-- ======================================================================
-- 1. gazettes Table
DROP TABLE IF EXISTS public.gazettes CASCADE;

CREATE TABLE
    public.gazettes (
        gazette_id TEXT NOT NULL PRIMARY KEY,
        volume INTEGER,
        issue INTEGER,
        booklet INTEGER,
        publish_date DATE,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

COMMENT ON TABLE public.gazettes IS 'Stores basic metadata for Legislative Yuan gazettes.';

CREATE TRIGGER set_gazettes_updated_at BEFORE
UPDATE ON public.gazettes FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 2. gazette_agendas Table
DROP TABLE IF EXISTS public.gazette_agendas CASCADE;

CREATE TABLE
    public.gazette_agendas (
        agenda_id TEXT NOT NULL PRIMARY KEY,
        gazette_id TEXT NOT NULL,
        volume INTEGER,
        issue INTEGER,
        booklet INTEGER,
        session INTEGER,
        term INTEGER,
        meeting_dates DATE[],
        subject TEXT,
        category_code INTEGER,
        start_page INTEGER,
        end_page INTEGER,
        parsed_content_url TEXT,
        official_page_url TEXT,
        official_pdf_url TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_gazette FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE
    );

COMMENT ON TABLE public.gazette_agendas IS 'Stores metadata for each agenda item within a gazette. `parsed_content_url` can be duplicated.';

CREATE TRIGGER set_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 3. analyzed_contents Table
DROP TABLE IF EXISTS public.analyzed_contents CASCADE;

CREATE TABLE
    public.analyzed_contents (
        id UUID NOT NULL DEFAULT gen_random_uuid () PRIMARY KEY,
        parsed_content_url TEXT NOT NULL UNIQUE,
        analysis_status TEXT NOT NULL DEFAULT 'pending'::TEXT,
        analysis_result JSONB,
        committee_name TEXT[], -- MODIFIED: Now a text array
        analyzed_at TIMESTAMPTZ,
        analysis_attempts INTEGER NOT NULL DEFAULT 0,
        processing_started_at TIMESTAMPTZ,
        error_message TEXT,
        last_error_type TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT analyzed_contents_analysis_status_check CHECK (
            analysis_status IN (
                'pending',
                'processing',
                'completed',
                'failed',
                'skipped'
            )
        )
    );

COMMENT ON TABLE public.analyzed_contents IS 'Stores AI analysis results and status. Committee_name is a text array.';

CREATE TRIGGER set_analyzed_contents_updated_at BEFORE
UPDATE ON public.analyzed_contents FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 4. job_state Table
DROP TABLE IF EXISTS public.job_state CASCADE;

CREATE TABLE
    public.job_state (
        job_name TEXT NOT NULL PRIMARY KEY,
        last_processed_id TEXT,
        last_run_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

COMMENT ON TABLE public.job_state IS 'Tracks the execution state and progress of background tasks.';

CREATE TRIGGER set_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- ======================================================================
-- Create Indexes
-- ======================================================================
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes (publish_date DESC);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_meeting_dates ON public.gazette_agendas USING GIN (meeting_dates);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_parsed_content_url_non_unique ON public.gazette_agendas (parsed_content_url)
WHERE
    parsed_content_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_attempts ON public.analyzed_contents (analysis_status, analysis_attempts);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_updated_at ON public.analyzed_contents (analysis_status, updated_at ASC);

-- Index for TEXT[] committee_name using GIN for array operations
CREATE INDEX IF NOT EXISTS idx_analyzed_contents_committee_gin ON public.analyzed_contents USING GIN (committee_name)
WHERE
    committee_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_result_gin ON public.analyzed_contents USING GIN (analysis_result);

-- ======================================================================
-- Set Permissions (Adjust as per your security model)
-- ======================================================================
GRANT USAGE ON SCHEMA public TO postgres,
anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION public.trigger_set_timestamp () TO postgres,
anon,
authenticated,
service_role;

GRANT
SELECT
    ON TABLE public.gazettes TO anon,
    authenticated;

GRANT
SELECT
    ON TABLE public.gazette_agendas TO anon,
    authenticated;

GRANT
SELECT
    ON TABLE public.analyzed_contents TO anon,
    authenticated;

GRANT
SELECT
    ON TABLE public.job_state TO service_role;

GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.analyzed_contents TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT
SELECT
    ON TABLES TO anon,
    authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL ON SEQUENCES TO service_role;

-- ======================================================================
-- Initial Data Setup
-- ======================================================================
INSERT INTO
    public.job_state (job_name, notes)
VALUES
    (
        'fetch-new-gazettes',
        'Tracks fetching new gazettes from ly.govapi.tw.'
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL,
    last_processed_id = NULL;

INSERT INTO
    public.job_state (job_name, notes)
VALUES
    (
        'analyze-pending-contents',
        'Tracks AI analysis of pending gazette contents (category 3 only).'
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL,
    last_processed_id = NULL;

INSERT INTO
    public.job_state (job_name, notes)
VALUES
    (
        'rescue-stuck-analyses',
        'Tracks rescuing of stuck analysis processes.'
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL,
    last_processed_id = NULL;

-- ======================================================================
-- End of Schema Initialization Script
-- ======================================================================