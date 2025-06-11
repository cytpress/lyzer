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
import { GazetteListItemSkeleton } from "../components/skeleton/GazetteListItemSkeleton";
import { HomepageFilterButtonSkeleton } from "../components/skeleton/FilterButtonSkeleton";
import { ErrorDisplay } from "../components/ErrorDisplay";
import { EmptyStateDisplay } from "../components/EmptyStateDisplay";

export default function Homepage() {
  const [currentPage, setCurrentPage] = useState(1);

  const { searchTerm, selectedCommittees, handleCommitteesToggle } =
    useSearchFilter();

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

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCommittees, searchTerm]);

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

  if (!data || data.itemsList.length === 0) {
    return <EmptyStateDisplay />;
  }

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
