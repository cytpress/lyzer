-- supabase/migrations/YYYYMMDDHHMMSS_initial_schema_with_urls.sql
-- (將 YYYYMMDDHHMMSS 替換為實際的時間戳)
-- ======================================================================
-- Schema Initialization Script for Gazette Data Processing (with JSONB and URLs)
-- Target: Creates all necessary tables, functions, triggers, indexes,
--         and permissions for a new database setup, using JSONB for results
--         and dedicated columns for official URLs.
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
-- 1. gazettes 表：儲存公報基本資料
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

COMMENT ON COLUMN public.gazettes.gazette_id IS '公報編號 (主鍵，例如 1137701)';

COMMENT ON COLUMN public.gazettes.volume IS '卷';

COMMENT ON COLUMN public.gazettes.issue IS '期';

COMMENT ON COLUMN public.gazettes.booklet IS '冊別';

COMMENT ON COLUMN public.gazettes.publish_date IS '公報發布日期';

COMMENT ON COLUMN public.gazettes.fetched_at IS '此公報資料首次從 API 抓取的時間';

-- 2. gazette_agendas 表：儲存議程詳細資料及分析狀態 (包含官方網址)
CREATE TABLE
    public.gazette_agendas (
        agenda_id text NOT NULL PRIMARY KEY, -- 公報議程編號 (主鍵，例如 1137701_00001)
        gazette_id text NOT NULL, -- 對應的公報編號 (外鍵)
        volume integer, -- 卷
        issue integer, -- 期
        booklet integer, -- 冊別
        session integer, -- 屆
        term integer, -- 會期
        meeting_dates date[], -- 會議日期 (可能有多天)
        subject text, -- 案由
        category_code integer, -- 類別代碼
        start_page integer, -- 起始頁碼
        end_page integer, -- 結束頁碼
        parsed_content_url text, -- 從 API 取得的 txt 或其他可解析內容的 URL
        official_page_url text, -- <<< ADDED >>> 官方公報網頁網址 (來自 API 的 公報網網址)
        official_pdf_url text, -- <<< ADDED >>> 官方公報完整 PDF 網址 (來自 API 的 公報完整PDF網址)
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
        analysis_result jsonb, -- 儲存 AI 分析後的摘要 JSON 物件，或分析失敗時的錯誤 JSON 物件
        fetched_at timestamptz NOT NULL DEFAULT now(), -- 此議程資料首次從 API 抓取的時間
        analyzed_at timestamptz, -- AI 分析完成的時間
        updated_at timestamptz NOT NULL DEFAULT now() -- 記錄最後更新時間
    );

COMMENT ON TABLE public.gazette_agendas IS '立法院公報議程資料、官方連結及分析狀態';

COMMENT ON COLUMN public.gazette_agendas.agenda_id IS '公報議程編號 (主鍵，例如 1137701_00001)';

COMMENT ON COLUMN public.gazette_agendas.gazette_id IS '對應的公報編號 (外鍵)';

COMMENT ON COLUMN public.gazette_agendas.volume IS '卷';

COMMENT ON COLUMN public.gazette_agendas.issue IS '期';

COMMENT ON COLUMN public.gazette_agendas.booklet IS '冊別';

COMMENT ON COLUMN public.gazette_agendas.session IS '屆別';

COMMENT ON COLUMN public.gazette_agendas.term IS '會期';

COMMENT ON COLUMN public.gazette_agendas.meeting_dates IS '會議日期 (可能有多天)';

COMMENT ON COLUMN public.gazette_agendas.subject IS '案由';

COMMENT ON COLUMN public.gazette_agendas.category_code IS '類別代碼';

COMMENT ON COLUMN public.gazette_agendas.start_page IS '起始頁碼';

COMMENT ON COLUMN public.gazette_agendas.end_page IS '結束頁碼';

COMMENT ON COLUMN public.gazette_agendas.parsed_content_url IS '從 API 取得的 txt 或其他可解析內容的 URL，供 AI 分析';

COMMENT ON COLUMN public.gazette_agendas.official_page_url IS '官方公報網頁網址 (來自 API 的 公報網網址)';

COMMENT ON COLUMN public.gazette_agendas.official_pdf_url IS '官方公報完整 PDF 網址 (來自 API 的 公報完整PDF網址)';

COMMENT ON COLUMN public.gazette_agendas.analysis_status IS 'AI 分析狀態 (pending, processing, completed, failed)';

COMMENT ON COLUMN public.gazette_agendas.analysis_result IS '儲存 AI 分析後的摘要 JSON 物件，或分析失敗時的錯誤 JSON 物件';

COMMENT ON COLUMN public.gazette_agendas.fetched_at IS '此議程資料首次從 API 抓取的時間';

COMMENT ON COLUMN public.gazette_agendas.analyzed_at IS 'AI 分析完成的時間';

COMMENT ON COLUMN public.gazette_agendas.updated_at IS '記錄最後更新時間 (由觸發器自動更新)';

-- 3. job_state 表：追蹤背景任務執行狀態
CREATE TABLE
    public.job_state (
        job_name text NOT NULL PRIMARY KEY, -- 任務名稱 (主鍵)
        last_processed_id text, -- 上次成功處理到的 ID (例如公報編號)
        last_run_at timestamptz, -- 上次執行時間
        updated_at timestamptz NOT NULL DEFAULT now() -- 記錄最後更新時間
    );

COMMENT ON TABLE public.job_state IS '追蹤背景任務 (如爬蟲、分析器) 的執行狀態';

COMMENT ON COLUMN public.job_state.job_name IS '任務名稱 (主鍵)';

COMMENT ON COLUMN public.job_state.last_processed_id IS '上次成功處理到的 ID (例如公報編號)';

COMMENT ON COLUMN public.job_state.last_run_at IS '上次執行時間';

COMMENT ON COLUMN public.job_state.updated_at IS '記錄最後更新時間 (由觸發器自動更新)';

-- ======================================================================
-- 添加外鍵約束
-- ======================================================================
ALTER TABLE public.gazette_agendas
ADD CONSTRAINT gazette_agendas_gazette_id_fkey FOREIGN KEY (gazette_id) REFERENCES public.gazettes (gazette_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT gazette_agendas_gazette_id_fkey ON public.gazette_agendas IS '確保 gazette_agendas 中的 gazette_id 參照到 gazettes 表中有效的 gazette_id。級聯刪除。';

-- ======================================================================
-- 創建索引
-- ======================================================================
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes USING btree (publish_date);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas USING btree (gazette_id);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_status ON public.gazette_agendas USING btree (analysis_status);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_category_code ON public.gazette_agendas USING btree (category_code);

CREATE INDEX IF NOT EXISTS idx_gazette_agendas_meeting_dates ON public.gazette_agendas USING gin (meeting_dates);

-- GIN for array searching
-- 優化查詢待分析或分析失敗且有內容URL的議程 (for worker jobs)
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_pending_analyze ON public.gazette_agendas (analysis_status)
WHERE
    parsed_content_url IS NOT NULL
    AND analysis_status IN ('pending', 'failed');

COMMENT ON INDEX public.idx_gazette_agendas_pending_analyze IS '優化查詢待分析或分析失敗且有內容URL的議程 (供 worker 任務使用)';

-- 為 analysis_result (JSONB) 添加 GIN 索引 (加速內部鍵值查詢)
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_analysis_result_gin ON public.gazette_agendas USING gin (analysis_result);

COMMENT ON INDEX public.idx_gazette_agendas_analysis_result_gin IS '加速對 analysis_result (JSONB) 內部鍵值的查詢';

-- ======================================================================
-- 綁定觸發器
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

-- Service role needs ALL for background jobs (upsert, etc.)
GRANT ALL ON TABLE public.gazettes TO service_role;

GRANT ALL ON TABLE public.gazette_agendas TO service_role;

GRANT ALL ON TABLE public.job_state TO service_role;

-- Anon and Authenticated users (e.g., your frontend) typically only need SELECT
GRANT
SELECT
    ON TABLE public.gazettes TO anon,
    authenticated;

-- Grant SELECT on specific columns for gazette_agendas to anon/authenticated
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
        official_page_url, -- <<< ADDED to GRANT >>>
        official_pdf_url, -- <<< ADDED to GRANT >>>
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

-- Consider if default SELECT needed for future tables:
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
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
    ('analyze-pending-agendas', NULL, NULL) ON CONFLICT (job_name)
DO NOTHING;

-- ======================================================================
-- End of Initialization Script
-- ======================================================================