import { FetchHomepageResult } from "../types/models";
import { fetchHomepageGazette } from "../services/gazetteService";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  NORMAL_COMMITTEES_LIST,
  SPECIAL_COMMITTEES_LIST,
  ITEM_PER_PAGE,
} from "../constants/committees";
import { HomepageFilterButton } from "../components/HomepageFilterButton";
import { HomepagePagination } from "../components/HomepagePagination";
import GazetteListItem from "../components/GazetteListItem";

export default function Homepage() {
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const { isPending, isError, data, error } = useQuery<
    FetchHomepageResult,
    Error
  >({
    queryKey: ["homepageGazettes", selectedCommittees, currentPage],
    queryFn: () =>
      fetchHomepageGazette({
        limit: ITEM_PER_PAGE,
        page: currentPage,
        selectedCommittees,
      }),
  });

  if (isPending) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data || data.itemsList.length === 0) return <span>查無公報資料</span>;

  function handleCommitteesToggle(committeeName: string) {
    setSelectedCommittees((prevList) => {
      if (!selectedCommittees.includes(committeeName)) {
        return [...prevList, committeeName];
      } else {
        return prevList.filter((committee) => committee !== committeeName);
      }
    });
  }

  function handlePageChange(pageNumber: number) {
    setCurrentPage(pageNumber);
  }

  return (
    <>
      <div className="flex flex-col items-center">
        <div>
          {NORMAL_COMMITTEES_LIST.map((committee) => (
            <HomepageFilterButton
              committeeName={committee}
              onToggle={handleCommitteesToggle}
            />
          ))}
        </div>
        <div>
          {SPECIAL_COMMITTEES_LIST.map((committee) => (
            <HomepageFilterButton
              committeeName={committee}
              onToggle={handleCommitteesToggle}
            />
          ))}
        </div>
      </div>

      <div>
        <ul className="space-y-6">
          {data.itemsList.map((gazetteItem) => (
            <GazetteListItem key={gazetteItem.id} gazetteItem={gazetteItem} />
          ))}
        </ul>
      </div>
      <HomepagePagination
        currentPage={currentPage}
        totalItemsCount={data.totalItemsCount}
        itemsPerPage={ITEM_PER_PAGE}
        onPageChange={handlePageChange}
      />
    </>
  );
}
