import generatePaginationRange from "../utils/generatePaginationRange";

interface PaginationProps {
  currentPage: number;
  totalItemsCount: number;
  itemsPerPage: number;
  onPageChange: (pageNumber: number) => void;
}

export function HomepagePagination({
  currentPage,
  totalItemsCount,
  itemsPerPage,
  onPageChange,
}: PaginationProps) {
  const maxPage = Math.ceil(totalItemsCount / itemsPerPage);
  const currentPagination = generatePaginationRange({
    currentPage,
    maxPage,
  });
  return (
    <div className="flex flex-row justify-center">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        上一頁
      </button>
      {currentPagination.map((pageNumber) => (
        <button onClick={() => onPageChange(pageNumber)} key={pageNumber}>
          {pageNumber}
        </button>
      ))}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === maxPage}
      >
        下一頁
      </button>
    </div>
  );
}
