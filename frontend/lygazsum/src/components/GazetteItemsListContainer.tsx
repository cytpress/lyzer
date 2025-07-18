import { ReactNode } from "react";
import { GazetteItem } from "@/types/models";
import { GazetteListItemSkeleton } from "@/components/feedback/GazetteListItemSkeleton";
import { ErrorDisplay } from "@/components/feedback/ErrorDisplay";
import { SearchFilterEmptyStateDisplay } from "@/components/feedback/SearchFilterEmptyStateDisplay";
import { ITEM_PER_PAGE } from "@/constants/committees";
import GazetteListItem from "./GazetteListItem";

interface GazetteItemsListContainerProps {
  items: GazetteItem[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  onRetry?: () => void;
  isBookmarked: (id: string) => boolean;
  onToggleBookmark: (id: string) => void;
  customEmptyState?: ReactNode;
}

export default function GazetteItemsListContainer({
  items,
  isPending,
  isError,
  error,
  onRetry,
  isBookmarked,
  onToggleBookmark,
  customEmptyState,
}: GazetteItemsListContainerProps) {
  // 頁面載入中時，顯示 HomepageFilterButtonSkeleton 作為骨架
  if (isPending) {
    return (
      <>
        <ul className="space-y-4 mb-13 md:mb-25">
          {Array.from({ length: ITEM_PER_PAGE }).map((_, index) => (
            <GazetteListItemSkeleton key={index} />
          ))}
        </ul>
      </>
    );
  }

  if (isError && error) {
    const handleRetry = onRetry || (() => {});
    return <ErrorDisplay errorMessage={error.message} onRetry={handleRetry} />;
  }

  // 找不到數據、數據列表為空，提供 EmptyStateDisplay 作為空狀態顯示
  if (!items || items.length === 0) {
    return (
      (customEmptyState && <>{customEmptyState}</>) || (
        <SearchFilterEmptyStateDisplay />
      )
    );
  }

  return (
    <div>
      {/* 公報項目列表 */}
      <ul className="space-y-4">
        {items.map((item) => (
          <GazetteListItem
            key={item.id}
            gazetteItem={item}
            isBookmarked={isBookmarked(item.id)}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </ul>
    </div>
  );
}
