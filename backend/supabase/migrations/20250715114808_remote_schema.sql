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
    pg_catalog.set_config ('search_path', '', false);

SET
    check_function_bodies = false;

SET
    xmloption = content;

SET
    client_min_messages = warning;

SET
    row_security = off;

CREATE EXTENSION IF NOT EXISTS "pg_cron"
WITH
    SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgroonga"
WITH
    SCHEMA "extensions";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE EXTENSION IF NOT EXISTS "pg_graphql"
WITH
    SCHEMA "graphql";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt"
WITH
    SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault"
WITH
    SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
WITH
    SCHEMA "extensions";

CREATE
OR REPLACE FUNCTION "public"."search_analyzed_contents" (
    "p_search_term" "text",
    "p_selected_committees" "text" [],
    "p_limit" integer,
    "p_offset" integer
) RETURNS TABLE (
    "item_id" "uuid",
    "relevance_score" double precision
) LANGUAGE "plpgsql" AS $$
BEGIN
    IF p_search_term IS NULL OR trim(p_search_term) = '' THEN
        RETURN QUERY SELECT NULL::UUID, NULL::DOUBLE PRECISION WHERE FALSE;
    ELSE
        RETURN QUERY
        SELECT
            ac.id, 
            pgroonga_score(ac.tableoid, ac.ctid)
        FROM
            analyzed_contents AS ac 
        WHERE
            ac.analysis_result &@~ p_search_term
            AND(
                p_selected_committees IS NULL 
                OR cardinality(p_selected_committees) = 0
                OR ac.committee_name && p_selected_committees
            )
        ORDER BY
            pgroonga_score(ac.tableoid, ac.ctid) DESC,
            ac.analyzed_at DESC,
            ac.id ASC
        LIMIT
            p_limit
        OFFSET
            p_offset;
    END IF;
END;
$$;

ALTER FUNCTION "public"."search_analyzed_contents" (
    "p_search_term" "text",
    "p_selected_committees" "text" [],
    "p_limit" integer,
    "p_offset" integer
) OWNER TO "postgres";

CREATE
OR REPLACE FUNCTION "public"."trigger_set_timestamp" () RETURNS "trigger" LANGUAGE "plpgsql" AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."trigger_set_timestamp" () OWNER TO "postgres";

COMMENT ON FUNCTION "public"."trigger_set_timestamp" () IS 'Automatically updates the updated_at column to the current timestamp before an UPDATE operation.';

SET
    default_tablespace = '';

SET
    default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS
    "public"."analyzed_contents" (
        "id" "uuid" DEFAULT "gen_random_uuid" () NOT NULL,
        "parsed_content_url" "text" NOT NULL,
        "analysis_status" "text" DEFAULT 'pending'::"text" NOT NULL,
        "analysis_result" "jsonb",
        "committee_name" "text" [],
        "analyzed_at" timestamp with time zone,
        "analysis_attempts" integer DEFAULT 0 NOT NULL,
        "processing_started_at" timestamp with time zone,
        "error_message" "text",
        "last_error_type" "text",
        "created_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "updated_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        CONSTRAINT "analyzed_contents_analysis_status_check" CHECK (
            (
                "analysis_status" = ANY (
                    ARRAY[
                        'pending'::"text",
                        'processing'::"text",
                        'completed'::"text",
                        'failed'::"text",
                        'skipped'::"text"
                    ]
                )
            )
        )
    );

ALTER TABLE "public"."analyzed_contents" OWNER TO "postgres";

COMMENT ON TABLE "public"."analyzed_contents" IS 'Stores AI analysis results and status. Committee_name is a text array.';

CREATE TABLE IF NOT EXISTS
    "public"."gazette_agendas" (
        "agenda_id" "text" NOT NULL,
        "gazette_id" "text" NOT NULL,
        "volume" integer,
        "issue" integer,
        "booklet" integer,
        "session" integer,
        "term" integer,
        "meeting_dates" "date" [],
        "subject" "text",
        "category_code" integer,
        "start_page" integer,
        "end_page" integer,
        "parsed_content_url" "text",
        "official_page_url" "text",
        "official_pdf_url" "text",
        "fetched_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "created_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "updated_at" timestamp with time zone DEFAULT "now" () NOT NULL
    );

ALTER TABLE "public"."gazette_agendas" OWNER TO "postgres";

COMMENT ON TABLE "public"."gazette_agendas" IS 'Stores metadata for each agenda item within a gazette. `parsed_content_url` can be duplicated.';

CREATE TABLE IF NOT EXISTS
    "public"."gazettes" (
        "gazette_id" "text" NOT NULL,
        "volume" integer,
        "issue" integer,
        "booklet" integer,
        "publish_date" "date",
        "fetched_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "created_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "updated_at" timestamp with time zone DEFAULT "now" () NOT NULL
    );

ALTER TABLE "public"."gazettes" OWNER TO "postgres";

COMMENT ON TABLE "public"."gazettes" IS 'Stores basic metadata for Legislative Yuan gazettes.';

CREATE TABLE IF NOT EXISTS
    "public"."job_state" (
        "job_name" "text" NOT NULL,
        "last_processed_id" "text",
        "last_run_at" timestamp with time zone,
        "notes" "text",
        "created_at" timestamp with time zone DEFAULT "now" () NOT NULL,
        "updated_at" timestamp with time zone DEFAULT "now" () NOT NULL
    );

ALTER TABLE "public"."job_state" OWNER TO "postgres";

COMMENT ON TABLE "public"."job_state" IS 'Tracks the execution state and progress of background tasks.';

CREATE OR REPLACE VIEW
    "public"."vw_detailed_gazette_items" AS
SELECT
    "ac"."id" AS "analyzed_content_id",
    "ac"."parsed_content_url",
    "ac"."analysis_result",
    "ac"."committee_name" AS "committee_names",
    "ga"."agenda_id",
    "ga"."subject" AS "agenda_subject",
    CASE
        WHEN ("cardinality" ("ga"."meeting_dates") > 0) THEN "ga"."meeting_dates" [1]
        ELSE NULL::"date"
    END AS "agenda_meeting_date",
    "ga"."start_page" AS "agenda_start_page",
    "ga"."end_page" AS "agenda_end_page",
    "ga"."official_page_url" AS "agenda_official_page_url",
    "ga"."official_pdf_url" AS "agenda_official_pdf_url",
    "g"."gazette_id" AS "parent_gazette_id",
    "g"."volume" AS "gazette_volume",
    "g"."issue" AS "gazette_issue",
    "g"."booklet" AS "gazette_booklet",
    "g"."publish_date" AS "gazette_publish_date"
FROM
    (
        (
            "public"."analyzed_contents" "ac"
            JOIN "public"."gazette_agendas" "ga" ON (
                (
                    "ac"."parsed_content_url" = "ga"."parsed_content_url"
                )
            )
        )
        JOIN "public"."gazettes" "g" ON (("ga"."gazette_id" = "g"."gazette_id"))
    )
WHERE
    (
        ("ac"."analysis_status" = 'completed'::"text")
        AND ("ac"."committee_name" IS NOT NULL)
    );

ALTER TABLE "public"."vw_detailed_gazette_items" OWNER TO "postgres";

COMMENT ON VIEW "public"."vw_detailed_gazette_items" IS 'Provides detailed information for a single analyzed content item, assuming a one-to-one relationship (or primary interest in one) between parsed_content_url and a gazette_agenda. Includes full AI analysis, specific agenda details (URLs, page numbers), and parent gazette metadata.';

CREATE OR REPLACE VIEW
    "public"."vw_homepage_gazette_items" AS
SELECT
    "ac"."id",
    "ac"."committee_name" AS "committee_names",
    (
        "ac"."analysis_result" ->> 'summary_title'::"text"
    ) AS "summary_title",
    (
        "ac"."analysis_result" ->> 'overall_summary_sentence'::"text"
    ) AS "overall_summary_sentence",
    "ga"."meeting_dates" [1] AS "meeting_date",
    "ac"."analyzed_at"
FROM
    (
        (
            "public"."analyzed_contents" "ac"
            JOIN "public"."gazette_agendas" "ga" ON (
                (
                    "ac"."parsed_content_url" = "ga"."parsed_content_url"
                )
            )
        )
        JOIN "public"."gazettes" "g" ON (("ga"."gazette_id" = "g"."gazette_id"))
    )
WHERE
    (
        ("ac"."analysis_status" = 'completed'::"text")
        AND ("ac"."committee_name" IS NOT NULL)
        AND ("ac"."analysis_result" IS NOT NULL)
        AND (
            (
                "ac"."analysis_result" ->> 'summary_title'::"text"
            ) IS NOT NULL
        )
        AND (
            (
                "ac"."analysis_result" ->> 'overall_summary_sentence'::"text"
            ) IS NOT NULL
        )
        AND ("ga"."meeting_dates" IS NOT NULL)
        AND ("cardinality" ("ga"."meeting_dates") > 0)
    );

ALTER TABLE "public"."vw_homepage_gazette_items" OWNER TO "postgres";

COMMENT ON VIEW "public"."vw_homepage_gazette_items" IS 'Provides structured data for the homepage. Includes primary_meeting_date (the first meeting date as a string) for sorting and display.';

ALTER TABLE ONLY "public"."analyzed_contents"
ADD CONSTRAINT "analyzed_contents_parsed_content_url_key" UNIQUE ("parsed_content_url");

ALTER TABLE ONLY "public"."analyzed_contents"
ADD CONSTRAINT "analyzed_contents_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gazette_agendas"
ADD CONSTRAINT "gazette_agendas_pkey" PRIMARY KEY ("agenda_id");

ALTER TABLE ONLY "public"."gazettes"
ADD CONSTRAINT "gazettes_pkey" PRIMARY KEY ("gazette_id");

ALTER TABLE ONLY "public"."job_state"
ADD CONSTRAINT "job_state_pkey" PRIMARY KEY ("job_name");

CREATE INDEX "idx_analyzed_contents_analysis_result_pgroonga" ON "public"."analyzed_contents" USING "pgroonga" (
    "analysis_result" "extensions"."pgroonga_jsonb_full_text_search_ops_v2"
);

CREATE INDEX "idx_analyzed_contents_committee_gin" ON "public"."analyzed_contents" USING "gin" ("committee_name")
WHERE
    ("committee_name" IS NOT NULL);

CREATE INDEX "idx_analyzed_contents_result_gin" ON "public"."analyzed_contents" USING "gin" ("analysis_result");

CREATE INDEX "idx_analyzed_contents_status_attempts" ON "public"."analyzed_contents" USING "btree" ("analysis_status", "analysis_attempts");

CREATE INDEX "idx_analyzed_contents_status_updated_at" ON "public"."analyzed_contents" USING "btree" ("analysis_status", "updated_at");

CREATE INDEX "idx_gazette_agendas_category_code" ON "public"."gazette_agendas" USING "btree" ("category_code");

CREATE INDEX "idx_gazette_agendas_first_meeting_date_desc" ON "public"."gazette_agendas" USING "btree" (("meeting_dates" [1]) DESC NULLS LAST)
WHERE
    (
        ("cardinality" ("meeting_dates") > 0)
        AND ("meeting_dates" [1] IS NOT NULL)
    );

CREATE INDEX "idx_gazette_agendas_gazette_id" ON "public"."gazette_agendas" USING "btree" ("gazette_id");

CREATE INDEX "idx_gazette_agendas_meeting_dates" ON "public"."gazette_agendas" USING "gin" ("meeting_dates");

CREATE INDEX "idx_gazette_agendas_parsed_content_url_non_unique" ON "public"."gazette_agendas" USING "btree" ("parsed_content_url")
WHERE
    ("parsed_content_url" IS NOT NULL);

CREATE INDEX "idx_gazettes_publish_date" ON "public"."gazettes" USING "btree" ("publish_date" DESC);

CREATE
OR REPLACE TRIGGER "set_analyzed_contents_updated_at" BEFORE
UPDATE ON "public"."analyzed_contents" FOR EACH ROW
EXECUTE FUNCTION "public"."trigger_set_timestamp" ();

CREATE
OR REPLACE TRIGGER "set_gazette_agendas_updated_at" BEFORE
UPDATE ON "public"."gazette_agendas" FOR EACH ROW
EXECUTE FUNCTION "public"."trigger_set_timestamp" ();

CREATE
OR REPLACE TRIGGER "set_gazettes_updated_at" BEFORE
UPDATE ON "public"."gazettes" FOR EACH ROW
EXECUTE FUNCTION "public"."trigger_set_timestamp" ();

CREATE
OR REPLACE TRIGGER "set_job_state_updated_at" BEFORE
UPDATE ON "public"."job_state" FOR EACH ROW
EXECUTE FUNCTION "public"."trigger_set_timestamp" ();

ALTER TABLE ONLY "public"."gazette_agendas"
ADD CONSTRAINT "fk_gazette" FOREIGN KEY ("gazette_id") REFERENCES "public"."gazettes" ("gazette_id") ON DELETE CASCADE;

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "anon";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON FUNCTION "public"."search_analyzed_contents" (
    "p_search_term" "text",
    "p_selected_committees" "text" [],
    "p_limit" integer,
    "p_offset" integer
) TO "anon";

GRANT ALL ON FUNCTION "public"."search_analyzed_contents" (
    "p_search_term" "text",
    "p_selected_committees" "text" [],
    "p_limit" integer,
    "p_offset" integer
) TO "authenticated";

GRANT ALL ON FUNCTION "public"."search_analyzed_contents" (
    "p_search_term" "text",
    "p_selected_committees" "text" [],
    "p_limit" integer,
    "p_offset" integer
) TO "service_role";

GRANT ALL ON FUNCTION "public"."trigger_set_timestamp" () TO "anon";

GRANT ALL ON FUNCTION "public"."trigger_set_timestamp" () TO "authenticated";

GRANT ALL ON FUNCTION "public"."trigger_set_timestamp" () TO "service_role";

GRANT ALL ON TABLE "public"."analyzed_contents" TO "anon";

GRANT ALL ON TABLE "public"."analyzed_contents" TO "authenticated";

GRANT ALL ON TABLE "public"."analyzed_contents" TO "service_role";

GRANT ALL ON TABLE "public"."gazette_agendas" TO "anon";

GRANT ALL ON TABLE "public"."gazette_agendas" TO "authenticated";

GRANT ALL ON TABLE "public"."gazette_agendas" TO "service_role";

GRANT ALL ON TABLE "public"."gazettes" TO "anon";

GRANT ALL ON TABLE "public"."gazettes" TO "authenticated";

GRANT ALL ON TABLE "public"."gazettes" TO "service_role";

GRANT ALL ON TABLE "public"."job_state" TO "anon";

GRANT ALL ON TABLE "public"."job_state" TO "authenticated";

GRANT ALL ON TABLE "public"."job_state" TO "service_role";

GRANT ALL ON TABLE "public"."vw_detailed_gazette_items" TO "anon";

GRANT ALL ON TABLE "public"."vw_detailed_gazette_items" TO "authenticated";

GRANT ALL ON TABLE "public"."vw_detailed_gazette_items" TO "service_role";

GRANT ALL ON TABLE "public"."vw_homepage_gazette_items" TO "anon";

GRANT ALL ON TABLE "public"."vw_homepage_gazette_items" TO "authenticated";

GRANT ALL ON TABLE "public"."vw_homepage_gazette_items" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON SEQUENCES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON FUNCTIONS TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON FUNCTIONS TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON TABLES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
GRANT ALL ON TABLES TO "service_role";

RESET ALL;