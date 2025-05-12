-- supabase/migrations/YYYYMMDDHHMMSS_initialize_app_schema_v2.sql
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
-- ------------ 啟用必要的擴充功能 ------------
CREATE EXTENSION IF NOT EXISTS "plpgsql"
WITH
    SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto"
WITH
    SCHEMA "extensions";

-- ------------ 設定模式和超時 ------------
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

-- ------------ 通用 updated_at 觸發器函數 ------------
CREATE
OR REPLACE FUNCTION public.trigger_set_timestamp () RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.trigger_set_timestamp () IS '在 UPDATE 操作前自動更新 updated_at 欄位為當前時間';

-- ======================================================================
-- 表定義 (Tables Definitions)
-- ======================================================================
-- 1. gazettes 表 (公報主表)
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

COMMENT ON TABLE public.gazettes IS '儲存立法院公報的基本元數據。';

-- ... (欄位註解)
CREATE TRIGGER set_gazettes_updated_at BEFORE
UPDATE ON public.gazettes FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 2. gazette_agendas 表 (公報議程元數據表)
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
        parsed_content_url TEXT, -- <<< 關鍵：這裡不加 UNIQUE 約束 >>>
        official_page_url TEXT,
        official_pdf_url TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_gazette FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE
    );

COMMENT ON TABLE public.gazette_agendas IS '儲存每個公報中包含的議程元數據。parsed_content_url 在此表允許重複。';

COMMENT ON COLUMN public.gazette_agendas.parsed_content_url IS '議程內容純文字版本的 URL，用於 AI 分析。在此表中允許重複，因為一個內容可能對應多個議程項。';

CREATE TRIGGER set_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 3. analyzed_contents 表 (AI 分析結果表)
DROP TABLE IF EXISTS public.analyzed_contents CASCADE;

CREATE TABLE
    public.analyzed_contents (
        id UUID NOT NULL DEFAULT gen_random_uuid () PRIMARY KEY,
        parsed_content_url TEXT NOT NULL UNIQUE, -- <<< 這裡 parsed_content_url 必須是唯一的 >>>
        analysis_status TEXT NOT NULL DEFAULT 'pending'::TEXT,
        analysis_result JSONB,
        committee_name TEXT,
        analyzed_at TIMESTAMPTZ,
        analysis_attempts INTEGER NOT NULL DEFAULT 0,
        shortened_analysis_attempts INTEGER NOT NULL DEFAULT 0,
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
                'skipped',
                'needs_shortened_retry',
                'processing_shortened',
                'partially_completed'
            )
        )
    );

COMMENT ON TABLE public.analyzed_contents IS '儲存對每個唯一 parsed_content_url 的 AI 分析結果及狀態。';

COMMENT ON COLUMN public.analyzed_contents.parsed_content_url IS '被分析內容的唯一純文字 URL，這是此表的主業務鍵之一。';

CREATE TRIGGER set_analyzed_contents_updated_at BEFORE
UPDATE ON public.analyzed_contents FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- 4. job_state 表 (任務執行狀態追蹤)
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

COMMENT ON TABLE public.job_state IS '追蹤背景任務 (如爬蟲、分析器) 的執行狀態和進度。';

CREATE TRIGGER set_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.trigger_set_timestamp ();

-- ======================================================================
-- 創建索引 (Indexes for Performance)
-- ======================================================================
-- gazettes 表
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes (publish_date DESC);

-- gazette_agendas 表
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_meeting_dates ON public.gazette_agendas USING GIN (meeting_dates);

-- 為 parsed_content_url 在 gazette_agendas 中創建一個常規（非唯一）索引，如果經常需要通過它查詢
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_parsed_content_url_non_unique ON public.gazette_agendas (parsed_content_url)
WHERE
    parsed_content_url IS NOT NULL;

-- analyzed_contents 表
-- UNIQUE 約束已在 parsed_content_url 上創建唯一索引，無需重複創建 idx_analyzed_contents_parsed_url
CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_attempts ON public.analyzed_contents (analysis_status, analysis_attempts);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_short_attempts ON public.analyzed_contents (analysis_status, shortened_analysis_attempts);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status_updated_at ON public.analyzed_contents (analysis_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_committee ON public.analyzed_contents (committee_name)
WHERE
    committee_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_result_gin ON public.analyzed_contents USING GIN (analysis_result);

-- ======================================================================
-- 設定權限 (Permissions - 根據需要調整)
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

-- job_state 通常只給 service_role
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
-- 初始資料設定 (Initial Data Setup)
-- ======================================================================
INSERT INTO
    public.job_state (job_name, last_run_at, notes)
VALUES
    (
        'fetch-new-gazettes',
        NULL,
        'Tracks the fetching of new gazettes from ly.govapi.tw.'
    ) ON CONFLICT (job_name)
DO
UPDATE
SET
    notes = EXCLUDED.notes,
    last_run_at = NULL,
    last_processed_id = NULL;

-- 如果重置，也清空 last_processed_id
INSERT INTO
    public.job_state (job_name, last_run_at, notes)
VALUES
    (
        'analyze-pending-contents',
        NULL,
        'Tracks the AI analysis of pending gazette contents.'
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