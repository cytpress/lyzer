-- supabase/migrations/YYYYMMDDHHMMSS_refactor_analyzed_contents.sql
-- ======================================================================
-- Schema Refactor Script for Gazette Data Processing
-- Target: Introduces analyzed_contents table for unique URL analysis,
--         adjusts gazette_agendas, and sets up related components.
-- Uses built-in gen_random_uuid() instead of uuid-ossp extension.
-- ======================================================================
-- ------------ 啟用必要的擴充功能 ------------
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

-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions"; -- <<< 不再需要 >>>
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

COMMENT ON SCHEMA "public" IS 'standard public schema';

-- ------------ 更新 updated_at 的觸發器函數 ------------
CREATE
OR REPLACE FUNCTION public.update_updated_at_column () RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column () IS '通用函數：在 UPDATE 操作前自動更新 updated_at 欄位為當前時間';

-- ======================================================================
-- 建表與設定 (Tables and Configuration)
-- ======================================================================
-- 1. gazettes 表
CREATE TABLE
    public.gazettes (
        gazette_id text NOT NULL PRIMARY KEY,
        volume integer,
        issue integer,
        booklet integer,
        publish_date date,
        fetched_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.gazettes IS '立法院公報基本資料';

-- ... (欄位註解省略)
-- 2. 新增表：analyzed_contents
CREATE TABLE
    public.analyzed_contents (
        id uuid NOT NULL DEFAULT gen_random_uuid () PRIMARY KEY, -- <<< 修改：使用 gen_random_uuid() >>>
        parsed_content_url text NOT NULL UNIQUE,
        analysis_status text NOT NULL DEFAULT 'pending'::text CONSTRAINT analyzed_contents_analysis_status_check CHECK (
            analysis_status = ANY (
                ARRAY[
                    'pending'::text,
                    'processing'::text,
                    'completed'::text,
                    'failed'::text
                ]
            )
        ),
        analysis_result jsonb,
        committee_name text DEFAULT NULL,
        analyzed_at timestamptz DEFAULT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.analyzed_contents IS '儲存每個唯一 parsed_content_url 對應內容的 AI 分析結果';

-- ... (欄位註解省略)
-- 3. gazette_agendas 表
CREATE TABLE
    public.gazette_agendas (
        agenda_id text NOT NULL PRIMARY KEY,
        gazette_id text NOT NULL,
        volume integer,
        issue integer,
        booklet integer,
        session integer,
        term integer,
        meeting_dates date[],
        subject text,
        category_code integer,
        start_page integer,
        end_page integer,
        parsed_content_url text,
        official_page_url text,
        official_pdf_url text,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.gazette_agendas IS '立法院公報議程元數據 (分析結果關聯至 analyzed_contents)';

-- ... (欄位註解省略)
-- 4. job_state 表
CREATE TABLE
    public.job_state (
        job_name text NOT NULL PRIMARY KEY,
        last_processed_id text,
        last_run_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.job_state IS '追蹤背景任務 (如爬蟲、分析器) 的執行狀態';

-- ... (欄位註解省略)
-- ======================================================================
-- 添加外鍵約束
-- ======================================================================
ALTER TABLE public.gazette_agendas
ADD CONSTRAINT gazette_agendas_gazette_id_fkey FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT gazette_agendas_gazette_id_fkey ON public.gazette_agendas IS '確保 gazette_agendas 中的 gazette_id 參照到有效的 gazettes 記錄。級聯刪除。';

-- ======================================================================
-- 創建索引
-- ======================================================================
-- gazettes 表索引
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes USING btree (publish_date);

-- analyzed_contents 表索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_analyzed_contents_parsed_url ON public.analyzed_contents USING btree (parsed_content_url);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_status ON public.analyzed_contents USING btree (analysis_status);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_committee ON public.analyzed_contents USING btree (committee_name);

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_pending ON public.analyzed_contents (analysis_status)
WHERE
    analysis_status = 'pending'::text;

CREATE INDEX IF NOT EXISTS idx_analyzed_contents_result_gin ON public.analyzed_contents USING gin (analysis_result);

-- gazette_agendas 表索引
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas USING btree (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas USING btree (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_meeting_dates ON public.gazette_agendas USING gin (meeting_dates);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_parsed_content_url ON public.gazette_agendas USING btree (parsed_content_url)
WHERE
    parsed_content_url IS NOT NULL;

COMMENT ON INDEX public.idx_gazette_agendas_parsed_content_url IS '加速根據 parsed_content_url 查找關聯的議程元數據';

-- ======================================================================
-- 綁定觸發器
-- ======================================================================
-- analyzed_contents 表
DROP TRIGGER IF EXISTS update_analyzed_contents_updated_at ON public.analyzed_contents;

CREATE TRIGGER update_analyzed_contents_updated_at BEFORE
UPDATE ON public.analyzed_contents FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_analyzed_contents_updated_at ON public.analyzed_contents IS '當 analyzed_contents 記錄被更新時，自動更新其 updated_at 欄位';

-- gazette_agendas 表
DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas;

CREATE TRIGGER update_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_gazette_agendas_updated_at ON public.gazette_agendas IS '當 gazette_agendas 記錄被更新時，自動更新其 updated_at 欄位';

-- job_state 表
DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state;

CREATE TRIGGER update_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_job_state_updated_at ON public.job_state IS '當 job_state 記錄被更新時，自動更新其 updated_at 欄位';

-- ======================================================================
-- 設定權限
-- ======================================================================
GRANT USAGE ON SCHEMA public TO postgres,
anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION public.update_updated_at_column () TO postgres,
anon,
authenticated,
service_role;

-- Service role 需要完全權限
GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.analyzed_contents TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

-- 前端 (anon, authenticated) 權限
GRANT
SELECT
    ON TABLE public.gazettes TO anon,
    authenticated;

GRANT
SELECT
    (
        id,
        parsed_content_url,
        analysis_status,
        analysis_result,
        committee_name,
        analyzed_at,
        created_at,
        updated_at
    ) ON TABLE public.analyzed_contents TO anon,
    authenticated;

GRANT
SELECT
    (
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
        parsed_content_url,
        official_page_url,
        official_pdf_url,
        fetched_at,
        updated_at
    ) ON TABLE public.gazette_agendas TO anon,
    authenticated;

-- 設定預設權限
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON SEQUENCES TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON FUNCTIONS TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON TABLES TO postgres,
service_role;

-- ======================================================================
-- 初始資料設定
-- ======================================================================
INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('fetch-new-gazettes', NULL, NULL) ON CONFLICT (job_name)
DO NOTHING;

INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('analyze-pending-contents', NULL, NULL) -- <<< Job Name 已修改 >>>
    ON CONFLICT (job_name)
DO NOTHING;

-- ======================================================================
-- End of Initialization Script
-- ======================================================================