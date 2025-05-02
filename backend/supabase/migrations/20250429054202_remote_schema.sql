-- supabase/migrations/YYYYMMDDHHMMSS_initial_schema_with_jsonb.sql
-- (將 YYYYMMDDHHMMSS 替換為實際的時間戳)
-- ======================================================================
-- Schema Initialization Script for Gazette Data Processing (with JSONB)
-- Target: Creates all necessary tables, functions, triggers, indexes,
--         and permissions for a new database setup, using JSONB for results.
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

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
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

COMMENT ON SCHEMA "public" IS 'standard public schema';

-- ------------ 創建更新 updated_at 的觸發器函數 ------------
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
-- 1. gazettes 表：儲存公報基本資料 (保持不變)
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

-- ... 其他 gazettes 表的註解 ...
-- 2. gazette_agendas 表：儲存議程詳細資料及分析狀態 (修改 analysis_result)
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
        analysis_status text NOT NULL DEFAULT 'pending'::text CONSTRAINT gazette_agendas_analysis_status_check CHECK (
            analysis_status = ANY (
                ARRAY[
                    'pending'::text,
                    'processing'::text,
                    'completed'::text,
                    'failed'::text
                ]
            )
        ),
        analysis_result jsonb, -- Stores AI analysis result (JSON format) or error object (JSON format)
        fetched_at timestamptz NOT NULL DEFAULT now(),
        analyzed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.gazette_agendas IS '立法院公報議程資料及分析狀態';

-- ... 其他 gazette_agendas 表的註解 ...
COMMENT ON COLUMN public.gazette_agendas.analysis_result IS '儲存 AI 分析後的摘要 JSON 物件，或分析失敗時的錯誤 JSON 物件';

-- 3. job_state 表：追蹤背景任務執行狀態 (保持不變)
CREATE TABLE
    public.job_state (
        job_name text NOT NULL PRIMARY KEY,
        last_processed_id text,
        last_run_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
    );

COMMENT ON TABLE public.job_state IS '追蹤背景任務 (如爬蟲、分析器) 的執行狀態';

-- ... 其他 job_state 表的註解 ...
-- ======================================================================
-- 添加外鍵約束 (保持不變)
-- ======================================================================
ALTER TABLE public.gazette_agendas
ADD CONSTRAINT gazette_agendas_gazette_id_fkey FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT gazette_agendas_gazette_id_fkey ON public.gazette_agendas IS 'Ensures gazette_id in gazette_agendas refers to a valid gazette_id in gazettes.';

-- ======================================================================
-- 創建索引 (可選：為 JSONB 添加 GIN 索引)
-- ======================================================================
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes USING btree (publish_date);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas USING btree (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_status ON public.gazette_agendas USING btree (analysis_status);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas USING btree (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_pending_analyze ON public.gazette_agendas (analysis_status)
WHERE
    parsed_content_url IS NOT NULL
    AND analysis_status IN ('pending', 'failed');

COMMENT ON INDEX public.idx_gazette_agendas_pending_analyze IS '優化查詢待分析或分析失敗且有內容URL的議程 (for worker jobs)';

-- --- <<< 新增/可選：為 analysis_result (JSONB) 添加 GIN 索引 >>> ---
-- 這個索引可以加速對 JSON 內部鍵值的查詢 (例如查詢所有包含特定 'item_title' 的記錄)
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_analysis_result_gin ON public.gazette_agendas USING gin (analysis_result);

COMMENT ON INDEX public.idx_gazette_agendas_analysis_result_gin IS '加速對 analysis_result (JSONB) 內部鍵值的查詢';

-- --- <<< 新增/可選結束 >>> ---
-- ======================================================================
-- 綁定觸發器 (保持不變)
-- ======================================================================
DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas;

CREATE TRIGGER update_gazette_agendas_updated_at BEFORE
UPDATE ON public.gazette_agendas FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_gazette_agendas_updated_at ON public.gazette_agendas IS '當 gazette_agendas 記錄被更新時，自動更新其 updated_at 欄位';

DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state;

CREATE TRIGGER update_job_state_updated_at BEFORE
UPDATE ON public.job_state FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column ();

COMMENT ON TRIGGER update_job_state_updated_at ON public.job_state IS '當 job_state 記錄被更新時，自動更新其 updated_at 欄位';

-- ======================================================================
-- 設定權限 (保持不變，SELECT 權限部分會自動適應 JSONB)
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

GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

GRANT
SELECT
    ON TABLE public.gazettes TO anon,
    authenticated;

-- SELECT 權限對 JSONB 欄位同樣有效，前端獲取到的是 JSON 字串
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
        analysis_status,
        analysis_result,
        analyzed_at,
        fetched_at,
        updated_at
    ) ON TABLE public.gazette_agendas TO anon,
    authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON SEQUENCES TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON FUNCTIONS TO postgres,
service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT ALL ON TABLES TO postgres,
service_role;

-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
-- ======================================================================
-- 初始資料設定 (保持不變)
-- ======================================================================
INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('fetch-new-gazettes', NULL, NULL) ON CONFLICT (job_name)
DO NOTHING;

INSERT INTO
    public.job_state (job_name, last_processed_id, last_run_at)
VALUES
    ('analyze-pending-agendas', NULL, NULL) ON CONFLICT (job_name)
DO NOTHING;

-- ======================================================================
-- End of Initialization Script
-- ======================================================================