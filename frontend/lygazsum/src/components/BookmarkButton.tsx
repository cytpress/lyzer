import { BookmarkIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolidIcon } from "@heroicons/react/24/solid";

interface BookmarkButtonProps {
  isBookmarked: boolean;
  onClick: (event: React.MouseEvent) => void;
}

export default function BookmarkButton({
  isBookmarked,
  onClick,
}: BookmarkButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center space-x-1 p-2 rounded-md hover:bg-neutral-100 cursor-pointer"
    >
      {isBookmarked ? (
        <BookmarkSolidIcon className="h-5 w-5 text-neutral-600" />
      ) : (
        <BookmarkIcon className="h-5 w-5 text-neutral-600" />
      )}
      <span className="text-sm text-neutral-600">
        {isBookmarked ? "已收藏" : "加入收藏"}
      </span>
    </button>
  );
}
