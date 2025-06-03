import { supabase } from "./supabaseClient";
import {
  FetchHomepageResult,
  DetailedGazetteItem,
  HomePageGazetteItem,
  RankedSearchResultsItem,
} from "../types/models";

interface FetchHomepageGazetteParams {
  limit?: number;
  selectedCommittees?: string[];
  page?: number;
  searchTerm?: string;
}

const VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS =
  "id, committee_names, summary_title, overall_summary_sentence, meeting_date, analyzed_at";

const VW_DETAILED_GAZETTE_ITEMS_COLUMNS =
  "analyzed_content_id, parsed_content_url, analysis_result, committee_names, agenda_id, agenda_subject, agenda_meeting_date, agenda_start_page, agenda_end_page, agenda_official_page_url, agenda_official_pdf_url, parent_gazette_id, gazette_volume, gazette_issue, gazette_booklet, gazette_publish_date";

export async function fetchHomepageGazette({
  limit = 10,
  selectedCommittees,
  page = 1,
  searchTerm,
}: FetchHomepageGazetteParams = {}): Promise<FetchHomepageResult> {
  console.log(`[gazetteService] Fetching latest ${limit} analyzed contents...`);

  let query;
  const itemsPerPage = limit;
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage - 1;

  if (searchTerm) {
    const calculatedOffset = (page - 1) * itemsPerPage;

    const {
      data: rankedSearchResults,
      error: rankedSearchResultsError,
      count: rankedSearchResultsCount,
    } = await supabase.rpc(
      "search_analyzed_contents",
      {
        p_search_term: searchTerm,
        p_limit: itemsPerPage,
        p_offset: calculatedOffset,
      },
      { count: "exact" }
    );

    if (rankedSearchResultsError) throw rankedSearchResultsError;

    const safeRankedSearchResults = Array.isArray(rankedSearchResults)
      ? rankedSearchResults
      : [];

    if (safeRankedSearchResults.length === 0) {
      return {
        itemsList: [],
        totalItemsCount: (rankedSearchResultsCount as number) || 0,
      };
    }

    const searchResultIdList = safeRankedSearchResults.map(
      (item: RankedSearchResultsItem) => item.item_id
    );

    const { data: matchedItemsFromView, error: matchedItemsFromViewError } =
      await supabase
        .from("vw_homepage_gazette_items")
        .select(VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS)
        .in("id", searchResultIdList);

    if (matchedItemsFromViewError) throw matchedItemsFromViewError;

    const safeMatchItemsFromView = Array.isArray(matchedItemsFromView)
      ? matchedItemsFromView
      : [];

    const mergedRankedItemsList = safeRankedSearchResults
      .map((rankedItem: RankedSearchResultsItem) => {
        const viewItem = safeMatchItemsFromView.find(
          (viewItem: HomePageGazetteItem) => viewItem.id === rankedItem.item_id
        );
        if (viewItem) {
          return {
            ...viewItem,
            score: rankedItem.relevance_score,
          };
        }
        return null;
      })
      .filter((item) => item !== null);

    return {
      itemsList: mergedRankedItemsList,
      totalItemsCount: rankedSearchResultsCount as number,
    };
  } else {
    query = supabase
      .from("vw_homepage_gazette_items")
      .select(VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS, { count: "exact" });

    if (selectedCommittees && selectedCommittees.length > 0) {
      const committeeString = `{${selectedCommittees?.join(",")}}`;
      query = query.filter("committee_names", "ov", committeeString);
    }

    query = query.order("meeting_date", { ascending: false });
  }

  query = query.range(startIndex, endIndex);

  const { data, count, error } = await query;

  if (error) {
    throw error;
  }

  return {
    itemsList: data,
    totalItemsCount: count || 0,
  };
}

export async function fetchDetailedGazetteById(
  id: string
): Promise<DetailedGazetteItem | null> {
  const { data, error } = await supabase
    .from("vw_detailed_gazette_items")
    .select(VW_DETAILED_GAZETTE_ITEMS_COLUMNS)
    .eq("analyzed_content_id", id)
    .single();

  // more than 1 rows
  if (error) {
    throw error;
  }

  // no data found
  if (!data) {
    return null;
  }

  return data as DetailedGazetteItem;
}
