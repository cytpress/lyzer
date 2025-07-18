import { FetchGazettesListResult, SortByType } from "@/types/models";
import { fetchHomepageGazette } from "@/services/gazetteService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ALL_COMMITTEES_LIST, ITEM_PER_PAGE } from "@/constants/committees";
import { useSearchFilter } from "@/context/SearchFilterContext";
import { useBookmark } from "@/context/BookmarkContext";
import { HomepageFilterButton } from "@/components/HomepageFilterButton";
import { HomepagePagination } from "@/components/HomepagePagination";
import { useWindowSize } from "@/hooks/useWindowSize";
import { HomepageFilterButtonSkeleton } from "@/components/feedback/FilterButtonSkeleton";
import GazetteItemsListContainer from "@/components/GazetteItemsListContainer";

/**
 * Homepage 元件
 * 網站的首頁，負責展示公報摘要列表、委員會篩選按鈕、分頁按鈕。
 */
export default function Homepage() {
  // 管理當前分頁
  const [currentPage, setCurrentPage] = useState(1);

  // 從 context 中取得搜尋詞、選中委員會列表、切換委員會選中狀態
  const {
    searchTerm,
    selectedCommittees,
    handleCommitteesToggle,
    sortBy,
    setSortBy,
  } = useSearchFilter();

  // 建立queryClient，供後續首次載入時，預先抓取常設委員會的篩選結果
  const queryClient = useQueryClient();

  // 取得螢幕寬度，用於分頁按鈕中渲染數量
  const currentWindowWidth = useWindowSize();

  const effectiveSortBy = searchTerm ? sortBy : "date_desc";

  const { isPending, isError, data, error, refetch, isSuccess } = useQuery<
    FetchGazettesListResult,
    Error
  >({
    queryKey: [
      "homepageGazettes",
      selectedCommittees,
      currentPage,
      searchTerm,
      effectiveSortBy,
    ],
    queryFn: () =>
      fetchHomepageGazette({
        limit: ITEM_PER_PAGE,
        page: currentPage,
        selectedCommittees,
        searchTerm,
        sortBy: effectiveSortBy,
      }),
    staleTime: Infinity,
  });

  const { isBookmarked, handleBookmarkToggle } = useBookmark();

  // 當有搜尋或篩選行為時，將當前頁面設定為第一頁
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCommittees, searchTerm]);

  useEffect(() => {
    //預載函式，預先載入所有單一委員篩選後的結果，搜尋後結果亦同
    const prefetchSort = searchTerm ? "relevance_desc" : "date_desc";
    function prefetchFilteredCommitteeData(committeeName: string) {
      queryClient.prefetchQuery({
        queryKey: [
          "homepageGazettes",
          [committeeName],
          1,
          searchTerm,
          prefetchSort,
        ],
        queryFn: () =>
          fetchHomepageGazette({
            limit: ITEM_PER_PAGE,
            selectedCommittees: [committeeName],
            page: 1,
            searchTerm: searchTerm,
          }),
        staleTime: Infinity,
      });
    }

    // 成功時預載
    if (isSuccess) {
      ALL_COMMITTEES_LIST.forEach((committee) => {
        prefetchFilteredCommitteeData(committee);
      });
    }
  }, [isSuccess, queryClient, searchTerm]);

  // 處理分頁改變，於 pagination 使用
  function handlePageChange(pageNumber: number) {
    setCurrentPage(pageNumber);
  }

  return (
    <>
      {/* 委員會篩選按鈕列表，共8個常設委員會 + 4個特殊委員會 */}
      <div className="flex items-center overflow-x-auto whitespace-nowrap py-4 my-2">
        <div className="space-x-3 px-2 mx-auto">
          {isPending ? (
            // 載入時顯示篩選按鈕的骨架
            <>
              <div className="inline-flex items-center space-x-3 px-2">
                <span>委員會篩選：</span>
                {Array.from({ length: 9 }).map((_, index) => (
                  <HomepageFilterButtonSkeleton key={index} />
                ))}
              </div>
            </>
          ) : (
            // 載入完成後顯示真實按鈕
            <>
              <span>委員會篩選：</span>
              {ALL_COMMITTEES_LIST.map((committee) => (
                <HomepageFilterButton
                  key={committee}
                  committeeName={committee}
                  onToggle={handleCommitteesToggle}
                  isSelected={selectedCommittees.includes(committee)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 排序 select */}
      {searchTerm && (
        <div className="w-11/12 md:w-4/5 mx-auto flex justify-end pb-2">
          <select
            className="text-base text-neutral-600 bg-neutral-50"
            name="searchSortBy"
            id="searchSortBy"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortByType)}
            disabled={isPending}
          >
            <option value="relevance_desc">出現次數：高 → 低</option>
            <option value="relevance_asc">出現次數：低 → 高</option>
            <option value="date_desc">開會日期：近 → 遠</option>
            <option value="date_asc">開會日期：遠 → 近</option>
          </select>
        </div>
      )}

      {/* 公報項目列表容器 */}
      <GazetteItemsListContainer
        items={data?.itemsList || []}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={refetch}
        isBookmarked={isBookmarked}
        onToggleBookmark={handleBookmarkToggle}
      />

      {/* 分頁元件列表 */}
      {data && data.totalItemsCount > ITEM_PER_PAGE && (
        <HomepagePagination
          currentPage={currentPage}
          totalItemsCount={data.totalItemsCount}
          itemsPerPage={ITEM_PER_PAGE}
          onPageChange={handlePageChange}
          currentWindowWidth={currentWindowWidth}
        />
      )}
    </>
  );
}
