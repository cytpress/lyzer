create index idx_analyzed_contents_analysis_result_pgroonga on analyzed_contents using pgroonga (
  "analysis_result" pgroonga_jsonb_full_text_search_ops_v2
);