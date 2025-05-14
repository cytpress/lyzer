DROP VIEW IF EXISTS public.vw_homepage_gazette_items;

CREATE VIEW public.vw_homepage_gazette_items AS
SELECT
    ac.id,
    ac.parsed_content_url,
    ac.committee_name AS committee_names, 
    (ac.analysis_result ->> 'summary_title') AS summary_title,
    (ac.analysis_result ->> 'overall_summary_sentence') AS overall_summary_sentence, 
    g.publish_date,
    ac.analysis_status 
FROM
    public.analyzed_contents ac
JOIN
    public.gazette_agendas ga ON ac.parsed_content_url = ga.parsed_content_url
JOIN
    public.gazettes g ON ga.gazette_id = g.gazette_id
WHERE
    ac.analysis_status = 'completed' 
    AND ac.committee_name IS NOT NULL
    AND ac.analysis_result IS NOT NULL 
    AND (ac.analysis_result ->> 'summary_title') IS NOT NULL 
    AND (ac.analysis_result ->> 'overall_summary_sentence') IS NOT NULL; 

-- 權限設定
-- 確保 anon 和 authenticated 角色可以讀取這個 View
GRANT SELECT ON TABLE public.vw_homepage_gazette_items TO anon, authenticated;

-- 註解 
COMMENT ON VIEW public.vw_homepage_gazette_items IS 'Provides structured data for the homepage gazette listing, joining analyzed_contents, gazette_agendas, and gazettes. Only shows completed analyses.';
