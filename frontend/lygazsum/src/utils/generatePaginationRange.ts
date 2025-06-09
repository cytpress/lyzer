import { BREAKPOINT_MD } from "../constants/breakpoints";
interface GeneratePaginationRangeParams {
  currentPage: number;
  maxPage: number;
  currentWindowWidth: number;
}

function range(start: number, end: number): number[] {
  if (start > end) return [];
  const length = end - start + 1;
  return Array.from({ length }, (_, i) => start + i);
}

export default function generatePaginationRange({
  currentPage,
  maxPage,
  currentWindowWidth,
}: GeneratePaginationRangeParams) {
  const LEFT_COUNT = currentWindowWidth > BREAKPOINT_MD ? 4 : 2;
  const RIGHT_COUNT = currentWindowWidth > BREAKPOINT_MD ? 5 : 2;
  // left + right + 1(current) = 10
  const PAGINATION_WINDOW_SIZE = currentWindowWidth > BREAKPOINT_MD ? 10 : 5;

  // maxPage <= 10
  if (maxPage <= PAGINATION_WINDOW_SIZE) return range(1, maxPage);

  let startPage = currentPage - LEFT_COUNT;
  let endPage = currentPage + RIGHT_COUNT;

  // left border
  if (startPage < 1) {
    startPage = 1;
    endPage = PAGINATION_WINDOW_SIZE;
    //right border
  } else if (endPage > maxPage) {
    endPage = maxPage;
    startPage = endPage - PAGINATION_WINDOW_SIZE + 1;
  }

  return range(startPage, endPage);
}
