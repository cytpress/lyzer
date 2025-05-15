import { HomePageGazetteItem } from "../types/models";
import { fetchHomepageGazette } from "../services/gazetteService";
import { useQuery } from "@tanstack/react-query";
import GazetteListItem from "../components/GazetteListItem";

export default function Homepage() {
  const { isPending, isError, data, error } = useQuery<
    HomePageGazetteItem[],
    Error
  >({
    queryKey: ["homepageGazettes"],
    queryFn: () => fetchHomepageGazette({ limit: 10 }),
  });

  if (isPending) return <span>讀取中...</span>;
  if (isError) return <span>錯誤: {error.message}</span>;
  if (!data || data.length === 0) return <span>查無公報資料</span>;

  return (
    <div>
      <ul>
        {data.map((gazetteItem) => (
          <GazetteListItem key={gazetteItem.id} gazetteItem={gazetteItem} />
        ))}
      </ul>
    </div>
  );
}
