import { HomePageGazetteItem } from "../types/models";
import { fetchHomepageGazette } from "../services/gazetteService";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  NORMAL_COMMITTEES_LIST,
  SPECIAL_COMMITTEES_LIST,
} from "../constants/committees";
import { HomepageFilterButton } from "../components/HomepageFilterButton";
import GazetteListItem from "../components/GazetteListItem";

export default function Homepage() {
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([]);
  const { isPending, isError, data, error } = useQuery<
    HomePageGazetteItem[],
    Error
  >({
    queryKey: ["homepageGazettes", selectedCommittees],
    queryFn: () => fetchHomepageGazette({ limit: 10, selectedCommittees }),
  });

  if (isPending) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data || data.length === 0) return <span>查無公報資料</span>;

  function handleCommitteesToggle(committeeName: string) {
    setSelectedCommittees((prevList) => {
      if (!selectedCommittees.includes(committeeName)) {
        return [...prevList, committeeName];
      } else {
        return prevList.filter((committee) => committee !== committeeName);
      }
    });
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
          {data.map((gazetteItem) => (
            <GazetteListItem key={gazetteItem.id} gazetteItem={gazetteItem} />
          ))}
        </ul>
      </div>
    </>
  );
}
