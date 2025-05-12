-- ======================================================================
-- Supabase App Schema Initialization Script
-- Version: 2.0
-- Description: Creates tables for gazettes, gazette_agendas,
--              analyzed_contents, and job_state.
--              Ensures gazette_agendas.parsed_content_url is NOT unique.
-- WARNING: This script is designed for a fresh setup or reset.
--          If you have existing tables with the same names,
--          they might be dropped or altered. BACKUP YOUR DATA.
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
-- 1. gazettes Table (Main gazette metadata)
DROP TABLE IF EXISTS public.gazettes CASCADE;

CREATE TABLE
    public.gazettes (
        gazette_id TEXT NOT NULL PRIMARY KEY, -- Unique identifier for the gazette (e.g., "11302001")
        volume INTEGER, -- Volume number
        issue INTEGER, -- Issue number within the volume
        booklet INTEGER, -- Booklet number, if applicable
        publish_date DATE, -- Publication date (YYYY-MM-DD)
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Timestamp of initial fetch/creation
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Timestamp of record creation
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Timestamp of last update
    );

COMMENT ON TABLE public.gazettes IS 'Stores basic metadata for Legislative Yuan gazettes.';

-- Column comments can be added here if specific fields need more explanation than their names provide.
-- e.g., COMMENT ON COLUMN public.gazettes.gazette_id IS 'Primary key, unique identifier from the source API.';
CREATE TRIGGER set_gazettes_updated_at BEFORE
UPDATE ON public.gazettes FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 2. gazette_agendas Table (Gazette agenda item metadata)
DROP TABLE IF EXISTS public.gazette_agendas CASCADE;

CREATE TABLE
    public.gazette_agendas (
        agenda_id TEXT NOT NULL PRIMARY KEY, -- Unique identifier for the agenda item
        gazette_id TEXT NOT NULL, -- Foreign key referencing gazettes.gazette_id
        volume INTEGER,
        issue INTEGER,
        booklet INTEGER,
        session INTEGER, -- Legislative Yuan term
        term INTEGER, -- Session period within the term
        meeting_dates DATE[], -- Array of meeting dates
        subject TEXT, -- Subject or title of the agenda item
        category_code INTEGER, -- Numeric code for agenda type/category
        start_page INTEGER,
        end_page INTEGER,
        parsed_content_url TEXT, -- URL to plain text content for AI analysis; DUPLICATES ALLOWED here
        official_page_url TEXT, -- URL to the official gazette page for this item
        official_pdf_url TEXT, -- URL to the full gazette PDF
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_gazette FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE
    );

COMMENT ON TABLE public.gazette_agendas IS 'Stores metadata for each agenda item within a gazette. `parsed_content_url` can be duplicated.';

COMMENT ON COLUMN public.gazette_agendas.parsed_content_url IS 'URL of the plain text version of agenda content, used for AI analysis. Duplicates are allowed as one content URL might correspond to multiple agenda entries.';

CREATE TRIGGER set_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 3. analyzed_contents Table (AI analysis results and status)
DROP TABLE IF EXISTS public.analyzed_contents CASCADE;

CREATE TABLE
    public.analyzed_contents (
        id UUID NOT NULL DEFAULT gen_random_uuid () PRIMARY KEY, -- Internal UUID primary key
        parsed_content_url TEXT NOT NULL UNIQUE, -- URL of the content analyzed; business key with UNIQUE constraint
        analysis_status TEXT NOT NULL DEFAULT 'pending'::TEXT, -- Current status of the analysis
        analysis_result JSONB, -- Stores the JSON result from AI or error details
        committee_name TEXT, -- Committee name extracted by AI
        analyzed_at TIMESTAMPTZ, -- Timestamp of successful analysis completion
        analysis_attempts INTEGER NOT NULL DEFAULT 0, -- Counter for regular analysis attempts
        shortened_analysis_attempts INTEGER NOT NULL DEFAULT 0, -- Counter for shortened prompt analysis attempts
        processing_started_at TIMESTAMPTZ, -- Timestamp when processing of this item began (for detecting stuck jobs)
        error_message TEXT, -- Brief error message from the last failed attempt
        last_error_type TEXT, -- Categorical type of the last error
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT analyzed_contents_analysis_status_check CHECK (
            analysis_status IN (
                'pending',
                'processing',
                'completed',
                'failed',
                'skipped',
                'needs_shortened_retry',
                'processing_shortened',
                'partially_completed'
            )
        )
    );

COMMENT ON TABLE public.analyzed_contents IS 'Stores AI analysis results and status for each unique parsed_content_url.';

COMMENT ON COLUMN public.analyzed_contents.parsed_content_url IS 'The unique URL of the plain text content that has been or will be analyzed. This is a key business identifier.';

CREATE TRIGGER set_analyzed_contents_updated_at BEFORE
UPDATE ON public.analyzed_contents FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 4. job_state Table (Tracking for background job execution status)
DROP TABLE IF EXISTS public.job_state CASCADE;

CREATE TABLE
    public.job_state (
        job_name TEXT NOT NULL PRIMARY KEY, -- Unique name of the background job (e.g., 'fetch-new-gazettes')
        last_processed_id TEXT, -- ID of the last item successfully processed by this job
        last_run_at TIMESTAMPTZ, -- Timestamp of the last execution attempt
        notes TEXT, -- Optional notes about the last run (e.g., summary, errors)
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

COMMENT ON TABLE public.job_state IS 'Tracks the execution state and progress of background tasks (e.g., fetchers, analyzers).';

CREATE TRIGGER set_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- ======================================================================
-- Create Indexes (for Performance)
-- ======================================================================
-- gazettes table
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes (publish_date DESC);

-- gazette_agendas table
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_meeting_dates ON public.gazette_agendas USING GIN (meeting_dates);

-- Regular (non-unique) index on parsed_content_url in gazette_agendas for frequent lookups
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_parsed_content_url_non_unique ON public.gazette_agendas (parsed_content_url)
WHERE
    parsed_content_url IS NOT NULL;

-- analyzed_contents table
-- The UNIQUE constraint on parsed_content_url automatically creates a unique index.
CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_attempts ON public.analyzed_contents (analysis_status, analysis_attempts);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_short_attempts ON public.analyzed_contents (analysis_status, shortened_analysis_attempts);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_updated_at ON public.analyzed_contents (analysis_status, updated_at ASC);

-- For fetching oldest items in a certain status
CREATE INDEX IF NOT EXISTS idx_analyzed_contents_committee ON public.analyzed_contents (committee_name)
WHERE
    committee_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_result_gin ON public.analyzed_contents USING GIN (analysis_result);

-- For querying JSONB content
-- ======================================================================
-- Set Permissions (Adjust as needed for your security model)
-- ======================================================================
-- Grant basic usage on the public schema
GRANT USAGE ON SCHEMA public TO postgres,
anon,
authenticated,
service_role;

-- Grant execute on the trigger function
GRANT
EXECUTE ON FUNCTION public.trigger_set_timestamp () TO postgres,
anon,
authenticated,
service_role;

-- Grant SELECT to anon and authenticated roles for read-only access if needed by frontend/clients
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

-- job_state is typically only accessed by service_role for background jobs
GRANT
SELECT
    ON TABLE public.job_state TO service_role;

-- Or more restrictive if needed
-- Grant ALL to service_role for Edge Functions and backend operations
GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.analyzed_contents TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

-- Default privileges for future tables/functions created by service_role (optional but good practice)
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
-- Initial Data Setup (Seed data for job_state table)
-- ======================================================================
INSERT INTO
    public.job_state (job_name, last_run_at, notes, last_processed_id)
VALUES
    (
        'fetch-new-gazettes',
        NULL,
        'Tracks fetching new gazettes from ly.govapi.tw.',
        NULL
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL, -- Reset on re-initialization
    last_processed_id = NULL;

-- Reset on re-initialization
INSERT INTO
    public.job_state (job_name, last_run_at, notes, last_processed_id)
VALUES
    (
        'analyze-pending-contents',
        NULL,
        'Tracks AI analysis of pending gazette contents.',
        NULL
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL, -- Reset on re-initialization
    last_processed_id = NULL;

-- Reset (this job might not use last_processed_id)
-- Add entry for the rescue job
INSERT INTO
    public.job_state (job_name, last_run_at, notes, last_processed_id)
VALUES
    (
        'rescue-stuck-analyses',
        NULL,
        'Tracks rescuing of stuck analysis processes.',
        NULL
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