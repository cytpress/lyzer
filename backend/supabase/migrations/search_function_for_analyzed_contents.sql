drop function IF exists search_analyzed_contents;

create function search_analyzed_contents (
    p_search_term TEXT,
    p_selected_committees text[],
    p_limit INT,
    p_offset INT
) RETURNS table (item_id UUID, relevance_score DOUBLE PRECISION) LANGUAGE plpgsql as $$
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