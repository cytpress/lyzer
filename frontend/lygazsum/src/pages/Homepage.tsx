import { FetchHomepageResult } from "../types/models";
import { fetchHomepageGazette } from "../services/gazetteService";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  NORMAL_COMMITTEES_LIST,
  SPECIAL_COMMITTEES_LIST,
  ITEM_PER_PAGE,
} from "../constants/committees";
import { useSearchFilter } from "../context/SearchFilterContext";
import { HomepageFilterButton } from "../components/HomepageFilterButton";
import { HomepagePagination } from "../components/HomepagePagination";
import GazetteListItem from "../components/HomepageItemsList";
import { useWindowSize } from "../hooks/useWindowSize";

export default function Homepage() {
  const [currentPage, setCurrentPage] = useState(1);

  const { searchTerm, selectedCommittees, handleCommitteesToggle } =
    useSearchFilter();

  const currentWindowWidth = useWindowSize();

  const { isPending, isError, data, error } = useQuery<
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

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCommittees, searchTerm]);

  if (isPending) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data || data.itemsList.length === 0) return <span>查無公報資料</span>;

  function handlePageChange(pageNumber: number) {
    setCurrentPage(pageNumber);
  }

  const allCommittees = [...NORMAL_COMMITTEES_LIST, ...SPECIAL_COMMITTEES_LIST];

  return (
    <>
      <div className="overflow-x-auto whitespace-nowrap py-4 my-2 flex justify-center">
        <div className="inline-flex items-center space-x-3 px-2">
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

      <ul className="space-y-4">
        {data.itemsList.map((gazetteItem) => (
          <GazetteListItem key={gazetteItem.id} gazetteItem={gazetteItem} />
        ))}
      </ul>

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
