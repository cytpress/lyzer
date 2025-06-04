import { Link } from "react-router-dom";
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSearchFilter } from "../context/SearchFilterContext";

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

  function handleSubmitSearch() {
    setSearchTerm(searchInputValue);
    if (location.pathname !== "/") navigate("/");
  }

  return (
    <header className="sticky top-0 bg-amber-200 h-16 z-50 content-center">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center ">
        <Link
          onClick={handleLogoCLick}
          to="/"
          className="flex flex-row items-center space-x-4"
        >
          <img src="/vite.svg" alt="placeholder" className="h-8 w-auto" />
          <p>LZY 立院公報懶人包</p>
        </Link>

        <div className="flex items-center space-x-4">
          <input
            value={searchInputValue}
            onChange={handleSearchInputValueChange}
            onKeyDown={handleKeyDown}
            type="search"
            placeholder="搜尋..."
            className="px-3 py-1.5 rounded-md text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hidden md:block"
          />
          <nav>
            <ul className="flex space-x-4">
              <li>
                <Link to="/about" className="...">
                  關於本站
                </Link>
              </li>
              <li>
                <Link to="/contact" className="...">
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
