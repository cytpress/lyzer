import { supabase } from "./supabaseClient";
import { FetchHomepageResult } from "../types/models";
import { DetailedGazetteItem } from "../types/models";

interface FetchHomepageGazetteParams {
  limit?: number;
  selectedCommittees?: string[];
  page?: number;
}

const VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS =
  "id, committee_names, summary_title, overall_summary_sentence, meeting_date, analyzed_at";

const VW_DETAILED_GAZETTE_ITEMS_COLUMNS =
  "analyzed_content_id, parsed_content_url, analysis_result, committee_names, agenda_id, agenda_subject, agenda_meeting_date, agenda_start_page, agenda_end_page, agenda_official_page_url, agenda_official_pdf_url, parent_gazette_id, gazette_volume, gazette_issue, gazette_booklet, gazette_publish_date";

export async function fetchHomepageGazette({
  limit = 10,
  selectedCommittees,
  page = 1,
}: FetchHomepageGazetteParams = {}): Promise<FetchHomepageResult> {
  console.log(`[gazetteService] Fetching latest ${limit} analyzed contents...`);

  const itemsPerPage = limit;
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage - 1;

  let query = supabase
    .from("vw_homepage_gazette_items")
    .select(VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS, { count: "exact" });

  if (selectedCommittees && selectedCommittees.length > 0) {
    const committeeString = `{${selectedCommittees?.join(",")}}`;
    query = query.filter("committee_names", "ov", committeeString);
  }

  query = query
    .order("meeting_date", { ascending: false })
    .range(startIndex, endIndex);

  const { data, count, error } = await query;

  if (error) {
    console.log(
      "[gazetteService] Error fetching Homepage Gazette items",
      error
    );
    throw error;
  }

  return { itemsList: data, totalItemsCount: count || 0 };
}

export async function fetchDetailedGazetteById(
  id: string
): Promise<DetailedGazetteItem | null> {
  console.log(`[gazetteService] Fetching detailed gazette for ID: ${id}`);

  const { data, error } = await supabase
    .from("vw_detailed_gazette_items")
    .select(VW_DETAILED_GAZETTE_ITEMS_COLUMNS)
    .eq("analyzed_content_id", id)
    .single();

  // more than 1 rows
  if (error) {
    console.log(
      `[gazetteService] Error fetching Detailed Gazette item for ID: ${id}`,
      error
    );
    throw error;
  }

  // no data found
  if (!data) {
    console.log(`[gazetteService] ID: ${id} Gazette item not found `);
    return null;
  }

  return data as DetailedGazetteItem;
}
