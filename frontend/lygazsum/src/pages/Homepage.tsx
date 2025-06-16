import { FetchHomepageResult } from "@/types/models";
import { fetchHomepageGazette } from "@/services/gazetteService";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  NORMAL_COMMITTEES_LIST,
  SPECIAL_COMMITTEES_LIST,
  ITEM_PER_PAGE,
} from "@/constants/committees";
import { useSearchFilter } from "@/context/SearchFilterContext";
import { HomepageFilterButton } from "@/components/HomepageFilterButton";
import { HomepagePagination } from "@/components/HomepagePagination";
import GazetteListItem from "@/components/HomepageItemsList";
import { useWindowSize } from "@/hooks/useWindowSize";
import { GazetteListItemSkeleton } from "@/components/feedback/GazetteListItemSkeleton";
import { HomepageFilterButtonSkeleton } from "@/components/feedback/FilterButtonSkeleton";
import { ErrorDisplay } from "@/components/feedback/ErrorDisplay";
import { EmptyStateDisplay } from "@/components/feedback/EmptyStateDisplay";

/**
 * Homepage 元件
 * 網站的首頁，負責展示公報摘要列表、委員會篩選按鈕、分頁按鈕。
 */
export default function Homepage() {
  // 管理當前分頁
  const [currentPage, setCurrentPage] = useState(1);

  // 從 context 中取得搜尋詞、選中委員會列表、切換委員會選中狀態
  const { searchTerm, selectedCommittees, handleCommitteesToggle } =
    useSearchFilter();

  // 取得螢幕寬度，用於分頁按鈕中渲染數量
  const currentWindowWidth = useWindowSize();

  const { isPending, isError, data, error, refetch } = useQuery<
    FetchHomepageResult,
    Error
  >({
    queryKey: ["homepageGazettes", selectedCommittees, currentPage, searchTerm],
    queryFn: () =>
      fetchHomepageGazette({
        limit: ITEM_PER_PAGE,
        page: currentPage,
        selectedCommittees,
        searchTerm,
      }),
  });

  // 當有搜尋或篩選行為時，將當前頁面設定為第一頁
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCommittees, searchTerm]);

  // 頁面載入中時，顯示 HomepageFilterButtonSkeleton 作為骨架
  if (isPending) {
    return (
      <>
        <div className="py-4 my-2 flex justify-center">
          <div className="inline-flex items-center space-x-3 px-2">
            {Array.from({ length: 9 }).map((_, index) => (
              <HomepageFilterButtonSkeleton key={index} />
            ))}
          </div>
        </div>
        <ul className="space-y-4 mb-13 md:mb-25">
          {Array.from({ length: ITEM_PER_PAGE }).map((_, index) => (
            <GazetteListItemSkeleton key={index} />
          ))}
        </ul>
      </>
    );
  }

  if (isError) {
    return <ErrorDisplay errorMessage={error.message} onRetry={refetch} />;
  }

  // 找不到數據、數據列表為空，提供 EmptyStateDisplay 作為空狀態顯示
  if (!data || data.itemsList.length === 0) {
    return <EmptyStateDisplay />;
  }

  // 處理分頁改變，於 pagination 使用
  function handlePageChange(pageNumber: number) {
    setCurrentPage(pageNumber);
  }

  const allCommittees = [...NORMAL_COMMITTEES_LIST, ...SPECIAL_COMMITTEES_LIST];

  return (
    <>
      {/* 委員會篩選按鈕列表，共8個常設委員會 + 4個特殊委員會 */}
      <div className="flex items-center overflow-x-auto whitespace-nowrap py-4 my-2">
        <div className="space-x-3 px-2 mx-auto">
          {allCommittees.map((committee) => (
            <HomepageFilterButton
              key={committee}
              committeeName={committee}
              onToggle={handleCommitteesToggle}
              isSelected={selectedCommittees.includes(committee)}
            />
          ))}
        </div>
      </div>

      {/* 公報項目列表 */}
      <ul className="space-y-4">
        {data.itemsList.map((gazetteItem) => (
          <GazetteListItem key={gazetteItem.id} gazetteItem={gazetteItem} />
        ))}
      </ul>

      {/* 分頁元件列表 */}
      <HomepagePagination
        currentPage={currentPage}
        totalItemsCount={data.totalItemsCount}
        itemsPerPage={ITEM_PER_PAGE}
        onPageChange={handlePageChange}
        currentWindowWidth={currentWindowWidth}
      />
    </>
  );
}
