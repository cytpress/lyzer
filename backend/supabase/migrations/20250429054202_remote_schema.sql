-- ------------ 清理舊結構 (可選，用於重設時確保乾淨狀態) ------------
-- DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas;
-- DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state;
-- DROP TABLE IF EXISTS public.gazette_agendas CASCADE;
-- DROP TABLE IF EXISTS public.gazettes CASCADE;
-- DROP TABLE IF EXISTS public.job_state CASCADE;
-- DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- ------------ 啟用必要的擴充功能 ------------
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
-- 其他你可能需要的擴充功能 (從你的 migration 中保留)
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- ------------ 設定模式和超時 ------------
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public, extensions', false); -- 確保 extensions 在 search_path
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

COMMENT ON SCHEMA "public" IS 'standard public schema';

-- ------------ 創建更新 updated_at 的函數 ------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.update_updated_at_column() IS '通用函數：在 UPDATE 操作前自動更新 updated_at 欄位為當前時間';

-- ------------ 建表與設定 ------------

-- 1. gazettes 表：儲存公報基本資料
CREATE TABLE IF NOT EXISTS public.gazettes (
    gazette_id text NOT NULL PRIMARY KEY, -- 公報編號 (API: 公報編號)
    volume integer,                      -- 卷 (API: 卷)
    issue integer,                       -- 期 (API: 期)
    booklet integer,                     -- 冊別 (API: 冊別)
    publish_date date,                   -- 發布日期 (API: 發布日期)
    fetched_at timestamptz NOT NULL DEFAULT now() -- 此公報資料的抓取時間
);
COMMENT ON TABLE public.gazettes IS '立法院公報基本資料';

-- 建立索引以加速查詢
CREATE INDEX IF NOT EXISTS idx_gazettes_publish_date ON public.gazettes USING btree (publish_date);

-- 2. gazette_agendas 表：儲存議程詳細資料及分析狀態
CREATE TABLE IF NOT EXISTS public.gazette_agendas (
    agenda_id text NOT NULL PRIMARY KEY,         -- 公報議程編號 (API: 公報議程編號)
    gazette_id text NOT NULL,                    -- 先不加 FK，稍後添加
    volume integer,                              -- 卷
    issue integer,                               -- 期
    booklet integer,                             -- 冊別
    session integer,                             -- 屆 (API: 屆)
    term integer,                                -- 會期 (API: 會期)
    meeting_dates date[],                        -- 會議日期 (API: 會議日期 string[], DB 存 date[])
    subject text,                                -- 案由 (API: 案由)
    start_page integer,                          -- 起始頁碼 (API: 起始頁碼)
    end_page integer,                            -- 結束頁碼 (API: 結束頁碼)
    parsed_content_url text,                     -- << 更正欄位名 >> 議程內容的 .txt URL (API: 處理後公報網址 type='txt'.url)
    analysis_status text NOT NULL DEFAULT 'pending'::text
        CONSTRAINT gazette_agendas_analysis_status_check -- 給 check 約束一個名字
        CHECK (analysis_status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])), -- 分析狀態
    analysis_result text,                        -- Gemini 分析結果 或 錯誤訊息
    fetched_at timestamptz NOT NULL DEFAULT now(), -- 此議程資料的抓取時間
    analyzed_at timestamptz,                     -- 分析完成時間
    updated_at timestamptz NOT NULL DEFAULT now()  -- << 新增欄位 >> 記錄的最後更新時間
);
COMMENT ON TABLE public.gazette_agendas IS '立法院公報議程資料及分析狀態';
COMMENT ON COLUMN public.gazette_agendas.parsed_content_url IS '議程內容的 .txt URL (API: 處理後公報網址 type=''txt''.url)';
COMMENT ON COLUMN public.gazette_agendas.updated_at IS '記錄的最後更新時間';


-- 建立索引以加速查詢
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_gazette_id ON public.gazette_agendas USING btree (gazette_id); -- 關聯查詢
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_status ON public.gazette_agendas USING btree (analysis_status); -- 按狀態查詢
-- << 新增索引 >> 優化 analyze-pending-agendas 的查詢 (查詢 status 是 pending/failed 且有 URL 的記錄)
CREATE INDEX IF NOT EXISTS idx_gazette_agendas_status_url_not_null ON public.gazette_agendas (analysis_status) WHERE parsed_content_url IS NOT NULL AND analysis_status IN ('pending', 'failed');
COMMENT ON INDEX public.idx_gazette_agendas_status_url_not_null IS '優化 analyze-pending-agendas 的查詢';

-- 添加外鍵約束 (在兩個表都創建後添加)
ALTER TABLE public.gazette_agendas
    ADD CONSTRAINT gazette_agendas_gazette_id_fkey FOREIGN KEY (gazette_id)
    REFERENCES public.gazettes(gazette_id) ON DELETE CASCADE;

-- 3. job_state 表：追蹤背景任務執行狀態
CREATE TABLE IF NOT EXISTS public.job_state (
    job_name text NOT NULL PRIMARY KEY,          -- 任務名稱 (對應到 Function 名稱, 例如 'fetch-new-gazettes')
    last_processed_id text,                      -- 上次成功處理到的 ID (例如 gazette_id)
    last_run_at timestamptz,                     -- 任務上次執行的時間
    updated_at timestamptz NOT NULL DEFAULT now()  -- 此狀態記錄的最後更新時間
);
COMMENT ON TABLE public.job_state IS '背景任務執行狀態追蹤';

-- ------------ 綁定觸發器 (自動更新 updated_at) ------------

-- 為 gazette_agendas 表綁定觸發器
DROP TRIGGER IF EXISTS update_gazette_agendas_updated_at ON public.gazette_agendas; -- 先移除，避免重複建立
CREATE TRIGGER update_gazette_agendas_updated_at
BEFORE UPDATE ON public.gazette_agendas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 為 job_state 表綁定觸發器
DROP TRIGGER IF EXISTS update_job_state_updated_at ON public.job_state; -- 先移除，避免重複建立
CREATE TRIGGER update_job_state_updated_at
BEFORE UPDATE ON public.job_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------ 設定權限 (從你的 migration 複製過來，通常本地開發影響不大，但保持一致) ------------
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

GRANT ALL ON TABLE "public"."gazettes" TO "anon";
GRANT ALL ON TABLE "public"."gazettes" TO "authenticated";
GRANT ALL ON TABLE "public"."gazettes" TO "service_role";

GRANT ALL ON TABLE "public"."gazette_agendas" TO "anon";
GRANT ALL ON TABLE "public"."gazette_agendas" TO "authenticated";
GRANT ALL ON TABLE "public"."gazette_agendas" TO "service_role";

GRANT ALL ON TABLE "public"."job_state" TO "anon";
GRANT ALL ON TABLE "public"."job_state" TO "authenticated";
GRANT ALL ON TABLE "public"."job_state" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- ------------ 初始資料設定 (可選) ------------
-- 為 'fetch-new-gazettes' 任務插入初始狀態記錄 (如果不存在的話)
INSERT INTO public.job_state (job_name, last_processed_id, last_run_at)
VALUES ('fetch-new-gazettes', NULL, NULL)
ON CONFLICT (job_name) DO NOTHING; -- 如果 'fetch-new-gazettes' 已存在，則不執行任何操作

-- RESET ALL; -- 通常 migration 檔案結尾不需要 RESET ALL