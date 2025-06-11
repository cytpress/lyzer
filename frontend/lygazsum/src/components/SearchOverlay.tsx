import { useSearchFilter } from "../context/SearchFilterContext";
import { useRef, useEffect, useState } from "react";

interface SearchOverlayProps {
  searchIsOpen: boolean;
  setIsSearchOpen: (searchIsOpen: boolean) => void;
}

export function SearchOverlay({
  searchIsOpen,
  setIsSearchOpen,
}: SearchOverlayProps) {
  const { handleSubmitSearch, searchInputValue, setSearchInputValue } =
    useSearchFilter();

  const [isVisible, setIsVisible] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setTimeout(() => {
      if (searchIsOpen) inputRef.current?.focus();
    }, 0);
  }, [searchIsOpen]);

  function handleSearchInputValueChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    setSearchInputValue(event.target.value);
  }

  function handleOverlaySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSubmitSearch();
    handleCloseOverlay();
  }

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
        onClick={handleCloseOverlay}
      >
        <form
          onSubmit={handleOverlaySubmit}
          onClick={(e) => e.stopPropagation()}
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
