// services/gazetteService.ts

import { supabase } from "@/services/supabaseClient";
import {
  FetchGazettesListResult,
  DetailedGazetteItem,
  GazetteItem,
  RankedSearchResultsItem,
} from "../types/models";

interface FetchHomepageGazetteParams {
  limit?: number;
  selectedCommittees?: string[];
  page?: number;
  searchTerm?: string;
  sortBy?: "relevance_desc" | "relevance_asc" | "date_desc" | "date_asc";
}

// 將 Supabase view 的欄位定義為常數，方便重用。
const VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS =
  "id, committee_names, summary_title, overall_summary_sentence, meeting_date, analyzed_at";

const VW_DETAILED_GAZETTE_ITEMS_COLUMNS =
  "analyzed_content_id, parsed_content_url, analysis_result, committee_names, agenda_id, agenda_subject, agenda_meeting_date, agenda_start_page, agenda_end_page, agenda_official_page_url, agenda_official_pdf_url, parent_gazette_id, gazette_volume, gazette_issue, gazette_booklet, gazette_publish_date";

/**
 * 從 Supabase 獲取首頁的公報項目列表。
 * 函式處理了兩種情況：
 * 1. 全文搜尋：如果提供了 `searchTerm`，則呼叫 PostgreSQL 的 `search_analyzed_contents` 函式進行搜尋。
 * 2. 一般篩選和分頁：如果沒有 `searchTerm`，則直接從 `vw_homepage_gazette_items` view 中查詢數據。
 *
 * @param {FetchHomepageGazetteParams} params - 包含查詢參數的物件。
 * @returns {Promise<FetchGazettesListResult>} - 包含項目列表和總數的 Promise。
 */
export async function fetchHomepageGazette({
  limit = 10,
  selectedCommittees,
  page = 1,
  searchTerm,
  sortBy,
}: FetchHomepageGazetteParams = {}): Promise<FetchGazettesListResult> {
  let query;
  const itemsPerPage = limit;
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage - 1;

  // --- 情況 1: 全文搜尋 ---
  if (searchTerm) {
    const calculatedOffset = (page - 1) * itemsPerPage;

    // 呼叫 Supabase中定義的 RPC
    const {
      data: rankedSearchResults,
      error: rankedSearchResultsError,
      count: rankedSearchResultsCount,
    } = await supabase.rpc(
      "search_analyzed_contents",
      {
        // 傳遞給函式的參數
        p_search_term: searchTerm,
        p_selected_committees: selectedCommittees,
        p_limit: itemsPerPage,
        p_offset: calculatedOffset,
        p_sort_by: sortBy,
      },
      { count: "exact" }
    );

    if (rankedSearchResultsError) throw rankedSearchResultsError;

    // RPC 的回傳數據安全檢查
    const safeRankedSearchResults = Array.isArray(rankedSearchResults)
      ? rankedSearchResults
      : [];

    if (safeRankedSearchResults.length === 0) {
      return {
        itemsList: [],
        totalItemsCount: (rankedSearchResultsCount as number) || 0,
      };
    }

    // `search_analyzed_contents` 只返回 ID 和相關性分數，
    // 需要根據這些 ID，再從 view 中查詢完整的項目數據。
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

    // 將搜尋結果 (帶有分數) 和 view 的數據合併。
    // 因為 .in() 查詢不保證回傳順序，必須根據搜尋結果的順序來排序。
    const mergedRankedItemsList = safeRankedSearchResults
      .map((rankedItem: RankedSearchResultsItem) => {
        const viewItem = safeMatchItemsFromView.find(
          (viewItem: GazetteItem) => viewItem.id === rankedItem.item_id
        );
        if (viewItem) {
          return {
            ...viewItem,
            // 將相關性分數加入到項目數據中
            score: rankedItem.relevance_score,
            highlighted_summary: rankedItem.highlighted_summary,
          };
        }
        return null;
      })
      .filter((item) => item !== null);

    return {
      itemsList: mergedRankedItemsList,
      totalItemsCount: rankedSearchResultsCount as number,
    };

    // --- 情況 2: 一般篩選和分頁 ---
  } else {
    query = supabase
      .from("vw_homepage_gazette_items")
      .select(VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS, { count: "exact" });

    // 如果有選擇委員會，則添加篩選條件。
    if (selectedCommittees && selectedCommittees.length > 0) {
      const committeeString = `{${selectedCommittees?.join(",")}}`;
      query = query.filter("committee_names", "ov", committeeString);
    }

    query = query.order("meeting_date", { ascending: false });
  }

  // 應用分頁
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

/**
 * 根據提供的 ID，獲取單一公報摘要的詳細數據。
 * @param {string} id - `analyzed_contents` 表的 UUID。
 * @returns {Promise<DetailedGazetteItem | null>} - 包含詳細數據的 Promise，若找不到則為 null。
 */
export async function fetchDetailedGazetteById(
  id: string
): Promise<DetailedGazetteItem | null> {
  const { data, error } = await supabase
    .from("vw_detailed_gazette_items")
    .select(VW_DETAILED_GAZETTE_ITEMS_COLUMNS)
    .eq("analyzed_content_id", id)
    .single();

  // 如果 .single() 因找到多筆或零筆而拋出錯誤
  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data as DetailedGazetteItem;
}

export async function fetchGazettesByIds(
  ids: string[]
): Promise<FetchGazettesListResult> {
  if (!ids || ids.length === 0) {
    return { itemsList: [], totalItemsCount: 0 };
  }

  const { data, error } = await supabase
    .from("vw_homepage_gazette_items")
    .select(VW_HOMEPAGE_GAZETTE_ITEMS_COLUMNS)
    .in("id", ids);

  if (error) {
    throw error;
  }

  const fetchedItems = data || [];

  const sortedItemList = ids
    .map((id) => fetchedItems.find((item) => item.id === id))
    .filter((item) => item !== undefined);

  return { itemsList: sortedItemList, totalItemsCount: sortedItemList.length };
}
