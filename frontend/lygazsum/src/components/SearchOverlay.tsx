import { useSearchFilter } from "@/context/SearchFilterContext";
import { useRef, useEffect, useState } from "react";

interface SearchOverlayProps {
  searchIsOpen: boolean;
  setIsSearchOpen: (searchIsOpen: boolean) => void;
}

/**
 * 於行動裝置中，提供一個簡易的搜尋介面。
 * 當使用者點擊標頭的搜尋圖示時，此元件會以動畫效果出現。
 *
 * @param {SearchOverlayProps} props - 包含開關狀態和設定函式的 props。
 */
export function SearchOverlay({
  searchIsOpen,
  setIsSearchOpen,
}: SearchOverlayProps) {
  // 從 context 獲取搜尋相關的狀態與函式
  const { handleSubmitSearch, searchInputValue, setSearchInputValue } =
    useSearchFilter();

  // `isVisible` state 用於控制淡入淡出和位移動畫效果，
  // 與 `searchIsOpen` props 分開，可以實現更流暢的出場動畫
  const [isVisible, setIsVisible] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // 當 `searchIsOpen` 變為 true 時，延遲一小段時間後將 isVisible 設為 true，觸發進入動畫。
  // 當 `searchIsOpen` 變為 false 時，立即將 isVisible 設為 false，觸發離開動畫。
  useEffect(() => {
    if (searchIsOpen) {
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 10);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [searchIsOpen]);

  // 當overlay開啟時，輸入自動聚焦。
  useEffect(() => {
    // 使用 setTimeout(..., 0) 將聚焦操作推遲到下一個事件循環，
    // 確保此時 input 元素已經可見且可以被聚焦。
    setTimeout(() => {
      if (searchIsOpen) inputRef.current?.focus();
    }, 0);
  }, [searchIsOpen]);

  /**
   * 處理輸入框內容的變化。
   */
  function handleSearchInputValueChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    setSearchInputValue(event.target.value);
  }

  /**
   * 處理表單提交事件。
   */
  function handleOverlaySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSubmitSearch();
    handleCloseOverlay();
  }

  /**
   * 處理關閉覆蓋層的邏輯。
   * 包括觸發出場動畫，並在動畫結束後真正地從 DOM 中移除元件。
   */
  function handleCloseOverlay() {
    setIsVisible(false);

    setTimeout(() => {
      setIsSearchOpen(false);
    }, 300);
  }

  if (!searchIsOpen) return null;
  if (searchIsOpen) {
    return (
      <div
        className={`flex flex-col items-center fixed inset-0 bg-black/60 z-50 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        // 點擊背景遮罩時關閉覆蓋層
        onClick={handleCloseOverlay}
      >
        <form
          onSubmit={handleOverlaySubmit}
          // 阻止點擊表單區域時觸發背景的 `handleCloseOverlay`
          onClick={(e) => e.stopPropagation()}
          // 根據 isVisible 狀態來控制輸入框的滑入/滑出效果
          className={`w-11/12 mt-24 transition-transform duration-300 ease-in-out ${
            isVisible ? "transform-none" : "-translate-y-10"
          }
    `}
        >
          <input
            value={searchInputValue}
            onChange={handleSearchInputValueChange}
            ref={inputRef}
            type="search"
            placeholder="搜尋..."
            className=" bg-white h-14 px-4 py-2 w-full text-neutral-900 focus:outline-none rounded-2xl"
          />
        </form>
      </div>
    );
  }
}
