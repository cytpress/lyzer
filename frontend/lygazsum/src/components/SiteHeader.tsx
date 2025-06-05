import { Link } from "react-router-dom";
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSearchFilter } from "../context/SearchFilterContext";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export function SiteHeader() {
  const [searchInputValue, setSearchInputValue] = useState("");

  const { setSearchTerm, searchTerm, clearFilterAndSearchTerm } =
    useSearchFilter();

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setSearchInputValue(searchTerm);
  }, [searchTerm]);

  function handleSearchInputValueChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    setSearchInputValue(event.target.value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmitSearch();
    }
  }

  function handleLogoCLick() {
    clearFilterAndSearchTerm();
  }

  function handleSubmitSearch(event?: React.FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    setSearchTerm(searchInputValue);
    if (location.pathname !== "/") navigate("/");
  }

  return (
    <header className="sticky top-0 border-b border-neutral-300 bg-white px-4 z-50 ">
      <div className="container max-w-7xl mx-auto flex justify-between items-center py-4">
        <Link
          onClick={handleLogoCLick}
          to="/"
          className="flex flex-row items-center space-x-2"
        >
          <img src="/vite.svg" alt="placeholder" className="h-8 w-auto" />
          <p className="font-semibold text-neutral-800">LZY 立院公報懶人包</p>
        </Link>

        <div className="flex items-center space-x-6">
          <form
            onSubmit={handleSubmitSearch}
            className="relative hidden md:block"
          >
            <input
              value={searchInputValue}
              onChange={handleSearchInputValueChange}
              onKeyDown={handleKeyDown}
              type="search"
              placeholder="搜尋..."
              className="px-3 py-2 w-60 pr-10 rounded-2xl text-sm text-neutral-900 border-2 border-neutral-300 focus:outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              className="
                absolute inset-y-0 right-0
                flex items-center
                px-3
                text-neutral-400
                focus:outline-none
              "
            >
              <MagnifyingGlassIcon className="h-5 w-5" />
            </button>
          </form>

          <nav>
            <ul className="flex items-center space-x-4">
              <li>
                <Link
                  to="/about"
                  className="px-2 py-2 font-medium text-neutral-700 hover:text-neutral-900 flex items-center"
                >
                  關於本站
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="px-2 py-2 font-medium text-neutral-700 hover:text-neutral-900 flex items-center"
                >
                  聯絡我
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
}
