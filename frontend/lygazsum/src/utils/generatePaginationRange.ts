import { BREAKPOINT_MD } from "@/constants/breakpoints";
interface GeneratePaginationRangeParams {
  currentPage: number;
  maxPage: number;
  currentWindowWidth: number;
}

/**
 * 生成一個數字陣列，用於表示分頁元件中應顯示的頁碼。
 * 邏輯會根據當前頁、總頁數和視窗寬度，動態計算出一個合理的頁碼範圍。
 * 例如，返回 [1, 2, 3, 4, 5] 或 [8, 9, 10, 11, 12]。
 *
 * @param {number} start - 範圍的起始數字。
 * @param {number} end - 範圍的結束數字。
 * @returns {number[]} - 包含從 start 到 end 的連續數字陣列。
 */
function range(start: number, end: number): number[] {
  if (start > end) return [];
  const length = end - start + 1;
  return Array.from({ length }, (_, i) => start + i);
}

/**
 * 根據螢幕大小，計算並生成用於分頁 UI 的頁碼範圍。

 * @param {GeneratePaginationRangeParams} params - 包含分頁計算所需參數的物件。
 * @returns {number[]} - 應在分頁元件中顯示的頁碼陣列。
 */
export default function generatePaginationRange({
  currentPage,
  maxPage,
  currentWindowWidth,
}: GeneratePaginationRangeParams) {
  // 根據視窗寬度決定當前頁左右兩側應顯示的頁碼數量
  const LEFT_COUNT = currentWindowWidth > BREAKPOINT_MD ? 4 : 2; // 大螢幕左側顯示4個，小螢幕2個
  const RIGHT_COUNT = currentWindowWidth > BREAKPOINT_MD ? 5 : 2; // 大螢幕右側顯示5個，小螢幕2個

  // 分頁窗口的總大小 (左側 + 右側 + 當前頁)，大螢幕為10頁、小螢幕為5頁
  const PAGINATION_WINDOW_SIZE = currentWindowWidth > BREAKPOINT_MD ? 10 : 5;

  // 情況 1：如果總頁數小於或等於窗口大小，則直接顯示所有頁碼。
  if (maxPage <= PAGINATION_WINDOW_SIZE) return range(1, maxPage);

  // 計算理想的起始和結束頁碼
  let startPage = currentPage - LEFT_COUNT;
  let endPage = currentPage + RIGHT_COUNT;

  // 情況 2：處理左邊界。如果計算出的起始頁小於 1，則將窗口固定在最左側。
  if (startPage < 1) {
    startPage = 1;
    endPage = PAGINATION_WINDOW_SIZE;

    // 情況 3：處理右邊界。如果計算出的結束頁大於總頁數，則將窗口固定在最右側。
  } else if (endPage > maxPage) {
    endPage = maxPage;
    startPage = endPage - PAGINATION_WINDOW_SIZE + 1;
  }

  return range(startPage, endPage);
}
