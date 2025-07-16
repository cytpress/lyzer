import {
  createContext,
  useState,
  ReactNode,
  useContext,
  useEffect,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SortByType } from "@/types/models";

/**
 * @interface SearchFilterContextType
 * 定義 SearchFilterContext 的資料結構。
 * @property {string} searchTerm - 已提交的搜尋關鍵字，用於觸發 API 查詢。
 * @property {function} setSearchTerm - 設定已提交的搜尋關鍵字。
 * @property {string[]} selectedCommittees - 已選擇的委員會篩選列表。
 * @property {function} handleCommitteesToggle - 切換委員會的選中狀態。
 * @property {function} clearFilterAndSearchTerm - 清除所有搜尋和篩選條件。
 * @property {string} searchInputValue - 搜尋輸入框中當前的（尚未提交的）值。
 * @property {function} setSearchInputValue - 設定搜尋輸入框的值。
 * @property {function} handleSubmitSearch - 提交搜尋的處理函式。
 */

interface SearchFilterContextType {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedCommittees: string[];
  handleCommitteesToggle: (committeeName: string) => void;
  clearFilterAndSearchTerm: () => void;
  searchInputValue: string;
  setSearchInputValue: (searchInputValue: string) => void;
  handleSubmitSearch: (event?: React.FormEvent<HTMLFormElement>) => void;
  sortBy: SortByType;
  setSortBy: (sortBy: SortByType) => void;
}

const SearchFilterContext = createContext<SearchFilterContextType | undefined>(
  undefined
);

interface SearchProviderProps {
  children: ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  //`searchTerm` 為使用者按下"Enter"後，真正用於搜尋的關鍵字。
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInputValue, setSearchInputValue] = useState("");
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortByType>("relevance_desc");

  const navigate = useNavigate();
  const location = useLocation();

  // 當`searchTerm`改變時，一同改變`searchInputValue`
  useEffect(() => {
    setSearchInputValue(searchTerm);
  }, [searchTerm]);

  /**
   * 處理首頁委員會篩選按鈕的點擊事件，切換其選中狀態。
   * @param {string} committeeName - 被點擊的委員會名稱。
   */
  function handleCommitteesToggle(committeeName: string) {
    setSelectedCommittees((prevList) => {
      // 如果使用者點擊的委員會已被選中(`selectedCommittees`包含點擊當下的委員會名稱)，則移除他
      if (!selectedCommittees.includes(committeeName)) {
        return [...prevList, committeeName];

        // 否則將使用者點擊的委員會加入`selectedCommittees`
      } else {
        return prevList.filter((committee) => committee !== committeeName);
      }
    });
  }

  /**
   * 清除所有搜尋和篩選，回到初始狀態（可透過點擊首頁達成）
   */
  function clearFilterAndSearchTerm() {
    setSearchTerm("");
    setSearchInputValue("");
    setSelectedCommittees([]);
    setSortBy("relevance_desc");
  }

  /**
   * 處理header中搜尋欄表單的提交事件
   * @param {React.FormEvent<HTMLFormElement>} [event] - 表單提交事件，可選。
   */
  function handleSubmitSearch(event?: React.FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();

    // 透過`setSearchTerm`，來觸發首頁的 useQuery 來重新抓取資料
    setSearchTerm(searchInputValue);

    // 搜尋時，預設為關聯性由高到低排序
    setSortBy("relevance_desc");

    // 如果使用者不在首頁搜尋，則引導回首頁
    if (location.pathname !== "/") navigate("/");
  }

  return (
    <SearchFilterContext.Provider
      value={{
        searchTerm,
        setSearchTerm,
        selectedCommittees,
        handleCommitteesToggle,
        clearFilterAndSearchTerm,
        searchInputValue,
        setSearchInputValue,
        handleSubmitSearch,
        sortBy,
        setSortBy,
      }}
    >
      {children}
    </SearchFilterContext.Provider>
  );
}

/**
 * @returns {SearchFilterContextType} - 返回 context 的值。
 * @throws {Error} - 如果在 SearchProvider 外部使用此 Hook，則會拋出錯誤。
 */
export function useSearchFilter(): SearchFilterContextType {
  const context = useContext(SearchFilterContext);
  if (context === undefined)
    throw new Error("useSearch must be used within a SearchProvider");
  return context;
}
