import generatePaginationRange from "@/utils/generatePaginationRange";
import { ChevronRightIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";

interface PaginationProps {
  currentPage: number;
  totalItemsCount: number;
  itemsPerPage: number;
  onPageChange: (pageNumber: number) => void;
  currentWindowWidth: number;
}

export function HomepagePagination({
  currentPage,
  totalItemsCount,
  itemsPerPage,
  onPageChange,
  currentWindowWidth,
}: PaginationProps) {
  const maxPage = Math.ceil(totalItemsCount / itemsPerPage);
  const currentPagination = generatePaginationRange({
    currentPage,
    maxPage,
    currentWindowWidth,
  });

  const currentPageClasses =
    "min-w-9 min-h-9 text-blue-600 hover:bg-neutral-200";
  const nonCurrentPageClasses =
    "min-w-9 min-h-9 text-neutral-600 hover:bg-neutral-200 cursor-pointer";

  return (
    <div className="flex items-center justify-center py-2 md:my-6 space-x-2">
      <button
        
        className="px-2 py-2 text-neutral-600 hover:bg-neutral-200 cursor-pointer"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      {currentPagination.map((pageNumber) => (
        <button
          className={
            currentPage === pageNumber
              ? currentPageClasses
              : nonCurrentPageClasses
          }
          onClick={() => onPageChange(pageNumber)}
          key={pageNumber}
        >
          {pageNumber}
        </button>
      ))}
      <button
        className="px-2 py-2 text-neutral-600 hover:bg-neutral-200 cursor-pointer"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === maxPage}
      >
        <ChevronRightIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
