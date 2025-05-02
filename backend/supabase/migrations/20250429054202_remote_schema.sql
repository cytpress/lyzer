-- ======================================================================
-- Schema Initialization Script for Gazette Data Processing
-- Target: Creates all necessary tables, functions, triggers, indexes,
--         and permissions for a new database setup.
-- ======================================================================
-- ------------ 清理舊結構 (可選，用於重設時確保乾淨狀態) ------------
-- NOTE: Uncomment these lines carefully ONLY if you need a full reset on an existing DB.
-- DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas;
-- DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state;
-- DROP TABLE IF EXISTS public.gazette_agendas CASCADE;
-- DROP TABLE IF EXISTS public.gazettes CASCADE;
-- DROP TABLE IF EXISTS public.job_state CASCADE;
-- DROP FUNCTION IF EXISTS public.update_updated_at_column();
-- ------------ 啟用必要的擴充功能 ------------
-- Ensure required PostgreSQL extensions are enabled. Using IF NOT EXISTS is safe.
-- CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog"; -- Uncomment if you use pg_cron
-- CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql"; -- Uncomment if you use pg_graphql
-- CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault"; -- Uncomment if you use Supabase Vault
CREATE EXTENSION IF NOT EXISTS "plpgsql"
WITH
    SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
WITH
    SCHEMA "extensions";

-- ------------ 設定模式和超時 ------------
-- Configure session parameters.
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

-- Set default search path to public
SET
    check_function_bodies = false;

SET
    xmloption = content;

SET
    client_min_messages = warning;

SET
    row_security = off;

-- Disable RLS during setup
COMMENT ON SCHEMA "public" IS 'standard public schema';

-- ------------ 創建更新 updated_at 的觸發器函數 ------------
-- Function to automatically update the updated_at timestamp on row modification.
CREATE
OR REPLACE FUNCTION public.update_updated_at_column () RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now(); -- Set updated_at to the current time
    RETURN NEW; -- Return the modified row
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column () IS '通用函數：在 UPDATE 操作前自動更新 updated_at 欄位為當前時間';

-- ======================================================================
-- 建表與設定 (Tables and Configuration)
-- ======================================================================
-- 1. gazettes 表：儲存公報基本資料
CREATE TABLE
    public.gazettes (
        gazette_id text NOT NULL PRIMARY KEY, -- 公報編號 (API: 公報編號), Use text for flexibility
        volume integer, -- 卷 (API: 卷)
        issue integer, -- 期 (API: 期)
        booklet integer, -- 冊別 (API: 冊別)
        publish_date date, -- 發布日期 (API: 發布日期)
        fetched_at timestamptz NOT NULL DEFAULT now() -- Timestamp when this gazette data was fetched
    );

COMMENT ON TABLE public.gazettes IS '立法院公報基本資料';

COMMENT ON COLUMN public.gazettes.gazette_id IS '公報編號 (API: 公報編號), Primary Key';

COMMENT ON COLUMN public.gazettes.publish_date IS '公報發布日期 (API: 發布日期)';

COMMENT ON COLUMN public.gazettes.fetched_at IS '此公報資料被爬蟲抓取的時間';

-- 2. gazette_agendas 表：儲存議程詳細資料及分析狀態
CREATE TABLE
    public.gazette_agendas (
        agenda_id text NOT NULL PRIMARY KEY, -- 公報議程編號 (API: 公報議程編號)
        gazette_id text NOT NULL, -- Foreign key to gazettes table (constraint added below)
        volume integer, -- 卷
        issue integer, -- 期
        booklet integer, -- 冊別
        session integer, -- 屆 (API: 屆)
        term integer, -- 會期 (API: 會期)
        meeting_dates date[], -- 會議日期 (API: 會議日期 string[], stored as date array)
        subject text, -- 案由 (API: 案由)
        category_code integer, -- << 直接包含 >> 議程類別代碼 (API: 類別代碼)
        start_page integer, -- 起始頁碼 (API: 起始頁碼)
        end_page integer, -- 結束頁碼 (API: 結束頁碼)
        parsed_content_url text, -- 議程內容的 .txt URL (from API: 處理後公報網址 type='txt'.url)
        analysis_status text NOT NULL DEFAULT 'pending'::text -- 分析狀態, default to 'pending'
        CONSTRAINT gazette_agendas_analysis_status_check -- Named CHECK constraint
        CHECK (
            analysis_status = ANY (
                ARRAY[
                    'pending'::text,
                    'processing'::text,
                    'completed'::text,
                    'failed'::text
                ]
            )
        ),
        analysis_result text, -- Stores AI analysis result (summary) or error message
        fetched_at timestamptz NOT NULL DEFAULT now(), -- Timestamp when this agenda data was fetched
        analyzed_at timestamptz, -- Timestamp when analysis was completed
        updated_at timestamptz NOT NULL DEFAULT now() -- Record's last update timestamp (auto-updated by trigger)
    );

COMMENT ON TABLE public.gazette_agendas IS '立法院公報議程資料及分析狀態';

COMMENT ON COLUMN public.gazette_agendas.agenda_id IS '公報議程編號 (API: 公報議程編號), Primary Key';

COMMENT ON COLUMN public.gazette_agendas.gazette_id IS '關聯的公報編號 (Foreign Key to gazettes.gazette_id)';

COMMENT ON COLUMN public.gazette_agendas.session IS '立法屆期 (API: 屆)';

COMMENT ON COLUMN public.gazette_agendas.term IS '立法會期 (API: 會期)';

COMMENT ON COLUMN public.gazette_agendas.meeting_dates IS '實際會議日期陣列 (YYYY-MM-DD)';

COMMENT ON COLUMN public.gazette_agendas.subject IS '議程案由 (API: 案由)';

COMMENT ON COLUMN public.gazette_agendas.category_code IS '議程類別代碼 (API: 類別代碼)';

COMMENT ON COLUMN public.gazette_agendas.parsed_content_url IS '議程內容純文字檔(.txt)的URL';

COMMENT ON COLUMN public.gazette_agendas.analysis_status IS '此議程的分析狀態 (pending, processing, completed, failed)';

COMMENT ON COLUMN public.gazette_agendas.analysis_result IS '儲存 AI 分析後的摘要內容或分析失敗的錯誤訊息';

COMMENT ON COLUMN public.gazette_agendas.fetched_at IS '此議程資料被爬蟲抓取的時間';

COMMENT ON COLUMN public.gazette_agendas.analyzed_at IS 'AI 完成分析此議程的時間';

COMMENT ON COLUMN public.gazette_agendas.updated_at IS '此記錄最後被更新的時間 (由觸發器維護)';

-- 3. job_state 表：追蹤背景任務執行狀態
CREATE TABLE
    public.job_state (
        job_name text NOT NULL PRIMARY KEY, -- Unique name of the background job (e.g., 'fetch-new-gazettes')
        last_processed_id text, -- ID of the last item successfully processed by the job
        last_run_at timestamptz, -- Timestamp of the last time the job ran
        updated_at timestamptz NOT NULL DEFAULT now() -- Timestamp of the last update to this state record (auto-updated by trigger)
    );

COMMENT ON TABLE public.job_state IS '追蹤背景任務 (如爬蟲、分析器) 的執行狀態';

COMMENT ON COLUMN public.job_state.job_name IS '背景任務的唯一識別名稱';

COMMENT ON COLUMN public.job_state.last_processed_id IS '該任務上次成功處理到的項目ID (例如公報ID或議程ID)';

COMMENT ON COLUMN public.job_state.last_run_at IS '該任務最後一次執行的時間戳';

COMMENT ON COLUMN public.job_state.updated_at IS '此狀態記錄最後被更新的時間 (由觸發器維護)';

-- ======================================================================
-- 添加外鍵約束 (Foreign Key Constraints)
-- ======================================================================
ALTER TABLE public.gazette_agendas
ADD CONSTRAINT gazette_agendas_gazette_id_fkey FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE;

-- If a gazette is deleted, delete its agendas too.
COMMENT ON CONSTRAINT gazette_agendas_gazette_id_fkey ON public.gazette_agendas IS 'Ensures gazette_id in gazette_agendas refers to a valid gazette_id in gazettes.';

-- ======================================================================
-- 創建索引 (Indexes)
-- ======================================================================
-- Using IF NOT EXISTS is safe and recommended for indexes.
-- Index on gazettes table
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes USING btree (publish_date);

-- For querying gazettes by date
-- Indexes on gazette_agendas table
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas USING btree (gazette_id);

-- For joining with gazettes
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_status ON public.gazette_agendas USING btree (analysis_status);

-- For filtering by analysis status
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas USING btree (category_code);

-- For filtering by category
-- Filtered index for worker tasks (pending/failed items with content URL)
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_pending_analyze ON public.gazette_agendas (analysis_status)
WHERE
    parsed_content_url IS NOT NULL
    AND analysis_status IN ('pending', 'failed');

COMMENT ON INDEX public.idx_gazette_agendas_pending_analyze IS '優化查詢待分析或分析失敗且有內容URL的議程 (for worker jobs)';

-- ======================================================================
-- 綁定觸發器 (Bind Triggers)
-- ======================================================================
-- Ensure triggers are dropped before creation to handle potential re-runs cleanly.
-- Trigger for gazette_agendas table
DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas;

CREATE TRIGGER update_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_gazette_agendas_updated_at ON public.gazette_agendas IS '當 gazette_agendas 記錄被更新時，自動更新其 updated_at 欄位';

-- Trigger for job_state table
DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state;

CREATE TRIGGER update_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_job_state_updated_at ON public.job_state IS '當 job_state 記錄被更新時，自動更新其 updated_at 欄位';

-- ======================================================================
-- 設定權限 (Permissions)
-- ======================================================================
-- Grant usage on the public schema to standard Supabase roles
GRANT USAGE ON SCHEMA public TO postgres,
anon,
authenticated,
service_role;

-- Grant execute permission on the trigger function
GRANT
EXECUTE ON FUNCTION public.update_updated_at_column () TO postgres,
anon,
authenticated,
service_role;

-- Grant permissions on tables to service_role (used by Edge Functions)
GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

-- Grant permissions for anonymous and authenticated users (adjust as needed)
-- Example: Allow read-only access to summaries for public users
GRANT
SELECT
    ON TABLE public.gazettes TO anon,
    authenticated;

GRANT
SELECT
    ( -- Grant SELECT only on specific columns needed by the public frontend
        agenda_id,
        gazette_id,
        volume,
        issue,
        booklet,
        session,
        term,
        meeting_dates,
        subject,
        category_code,
        start_page,
        end_page,
        analysis_status,
        analysis_result,
        analyzed_at,
        fetched_at,
        updated_at
    ) ON TABLE public.gazette_agendas TO anon,
    authenticated;

-- Typically, job_state is not exposed publicly:
-- REVOKE ALL ON TABLE public.job_state FROM anon, authenticated; -- Explicitly revoke if needed
-- Default privileges for future objects created by postgres in this schema
-- Ensures service_role can access future tables/functions/sequences
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON SEQUENCES TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON FUNCTIONS TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON TABLES TO postgres,
service_role;

-- Optionally grant default read access to public roles for future tables
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
-- ======================================================================
-- 初始資料設定 (Optional Initial Data)
-- ======================================================================
-- Initialize the state for background jobs if they don't exist.
-- Using ON CONFLICT DO NOTHING makes this safe to run multiple times.
INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('fetch-new-gazettes', NULL, NULL) ON CONFLICT (job_name)
DO NOTHING;

INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('analyze-pending-agendas', NULL, NULL) -- Add state for the analysis job
    ON CONFLICT (job_name)
DO NOTHING;

-- ======================================================================
-- End of Initialization Script
-- ======================================================================