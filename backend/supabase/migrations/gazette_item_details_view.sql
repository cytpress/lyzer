DROP VIEW IF EXISTS public.vw_detailed_gazette_item;

CREATE VIEW public.vw_detailed_gazette_item AS
SELECT
    -- 來自 analyzed_contents (ac)
    ac.id AS analyzed_content_id,
    ac.parsed_content_url,
    ac.analysis_result,    
    ac.committee_name AS committee_names,
    ac.analysis_status,

    -- 來自 gazette_agendas (ga) - 
    ga.agenda_id,
    ga.subject AS agenda_subject,
    ga.meeting_dates AS agenda_meeting_dates,
    ga.start_page AS agenda_start_page,     
    ga.end_page AS agenda_end_page,         
    ga.official_page_url AS agenda_official_page_url,
    ga.official_pdf_url AS agenda_official_pdf_url,

    -- 來自 gazettes (g)
    g.gazette_id AS parent_gazette_id,
    g.volume AS gazette_volume,
    g.issue AS gazette_issue,
    g.booklet AS gazette_booklet,
    g.publish_date AS gazette_publish_date
FROM
    public.analyzed_contents ac
JOIN
    public.gazette_agendas ga ON ac.parsed_content_url = ga.parsed_content_url -- 關鍵連接
JOIN
    public.gazettes g ON ga.gazette_id = g.gazette_id
WHERE
    ac.analysis_status = 'completed'
    AND ac.committee_name IS NOT NULL
;

-- 權限設定
GRANT SELECT ON TABLE public.vw_detailed_gazette_item TO anon, authenticated;

-- 註解
COMMENT ON VIEW public.vw_detailed_gazette_item IS 'Provides detailed information for a single analyzed content item, assuming a one-to-one relationship (or primary interest in one) between parsed_content_url and a gazette_agenda. Includes full AI analysis, specific agenda details (URLs, page numbers), and parent gazette metadata.';
