import { useBookmark } from "@/context/BookmarkContext";
import { useQuery } from "@tanstack/react-query";
import { fetchGazettesByIds } from "@/services/gazetteService";
import GazetteItemsListContainer from "@/components/GazetteItemsListContainer";
import { GenericEmptyState } from "@/components/feedback/GenericEmptyState";
import { Link } from "react-router-dom";

export default function BookmarksPage() {
  const { bookmarkedIds, isBookmarked, handleBookmarkToggle } = useBookmark();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["bookmarkedGazettes", bookmarkedIds],
    queryFn: () => fetchGazettesByIds(bookmarkedIds),
    enabled: bookmarkedIds.length > 0,
  });

  const actuallyLoading = bookmarkedIds.length > 0 && isPending;

  const customEmptyUI = (
    <Link
      to="/"
      className="inline-flex gap-x-2 rounded-xl px-5 py-2 text-neutral-700 hover:text-neutral-900 border-2 border-neutral-500 hover:border-neutral-800 transition-colors"
    >
      返回首頁
    </Link>
  );

  return (
    <div className="w-11/12 md:w-4/5 mx-auto py-8">
      {bookmarkedIds.length > 0 && !actuallyLoading && (
        <div className="w-11/12 md:w-4/5 mx-auto py-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-neutral-900">
            我的收藏
          </h1>
        </div>
      )}
      <GazetteItemsListContainer
        items={data?.itemsList || []}
        isPending={actuallyLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isBookmarked={isBookmarked}
        onToggleBookmark={handleBookmarkToggle}
        customEmptyState={
          <GenericEmptyState message="目前無收藏摘要！">
            {customEmptyUI}
          </GenericEmptyState>
        }
      />
    </div>
  );
}
