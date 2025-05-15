drop view IF exists public.vw_detailed_gazette_items;

create view
    public.vw_detailed_gazette_items as
select
    -- 來自 analyzed_contents (ac)
    ac.id as analyzed_content_id,
    ac.parsed_content_url,
    ac.analysis_result,
    ac.committee_name as committee_names,
    -- 來自 gazette_agendas (ga) - 
    ga.agenda_id,
    ga.subject as agenda_subject,
    (
        case
            when cardinality(ga.meeting_dates) > 0 then ga.meeting_dates[1]
            else null
        end
    ) as agenda_meeting_date,
    ga.start_page as agenda_start_page,
    ga.end_page as agenda_end_page,
    ga.official_page_url as agenda_official_page_url,
    ga.official_pdf_url as agenda_official_pdf_url,
    -- 來自 gazettes (g)
    g.gazette_id as parent_gazette_id,
    g.volume as gazette_volume,
    g.issue as gazette_issue,
    g.booklet as gazette_booklet,
    g.publish_date as gazette_publish_date
from
    public.analyzed_contents ac
    join public.gazette_agendas ga on ac.parsed_content_url = ga.parsed_content_url
    join public.gazettes g on ga.gazette_id = g.gazette_id
where
    ac.analysis_status = 'completed'
    and ac.committee_name is not null;

-- 權限設定
grant
select
    on table public.vw_detailed_gazette_items to anon,
    authenticated;

-- 註解
COMMENT on VIEW public.vw_detailed_gazette_items is 'Provides detailed information for a single analyzed content item, assuming a one-to-one relationship (or primary interest in one) between parsed_content_url and a gazette_agenda. Includes full AI analysis, specific agenda details (URLs, page numbers), and parent gazette metadata.';