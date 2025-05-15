-- Supabase > SQL Editor > New query
drop view IF exists public.vw_homepage_gazette_items;

create view
    public.vw_homepage_gazette_items as
select
    ac.id,
    ac.committee_name as committee_names,
    (ac.analysis_result ->> 'summary_title') as summary_title,
    (ac.analysis_result ->> 'overall_summary_sentence') as overall_summary_sentence,
    (
        case
            when cardinality(ga.meeting_dates) > 0 then ga.meeting_dates[1]
            else null
        end
    ) as meeting_date,
    ac.analyzed_at
from
    public.analyzed_contents ac
    join public.gazette_agendas ga on ac.parsed_content_url = ga.parsed_content_url
    join public.gazettes g on ga.gazette_id = g.gazette_id
where
    ac.analysis_status = 'completed'
    and ac.committee_name is not null
    and ac.analysis_result is not null
    and (ac.analysis_result ->> 'summary_title') is not null
    and (ac.analysis_result ->> 'overall_summary_sentence') is not null
    and ga.meeting_dates is not null
    and cardinality(ga.meeting_dates) > 0;

-- 權限設定
grant
select
    on table public.vw_homepage_gazette_items to anon,
    authenticated;

-- 註解
COMMENT on VIEW public.vw_homepage_gazette_items is 'Provides structured data for the homepage. Includes primary_meeting_date (the first meeting date as a string) for sorting and display.';