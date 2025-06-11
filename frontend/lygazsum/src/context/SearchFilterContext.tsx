import {
  createContext,
  useState,
  ReactNode,
  useContext,
  useEffect,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface SearchFilterContextType {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedCommittees: string[];
  handleCommitteesToggle: (committeeName: string) => void;
  clearFilterAndSearchTerm: () => void;
  searchInputValue: string;
  setSearchInputValue: (searchInputValue: string) => void;
  handleSubmitSearch: (event?: React.FormEvent<HTMLFormElement>) => void;
}

const SearchFilterContext = createContext<SearchFilterContextType | undefined>(
  undefined
);

interface SearchProviderProps {
  children: ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInputValue, setSearchInputValue] = useState("");
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setSearchInputValue(searchTerm);
  }, [searchTerm]);

  function handleCommitteesToggle(committeeName: string) {
    setSelectedCommittees((prevList) => {
      if (!selectedCommittees.includes(committeeName)) {
        return [...prevList, committeeName];
      } else {
        return prevList.filter((committee) => committee !== committeeName);
      }
    });
  }

  function clearFilterAndSearchTerm() {
    setSearchTerm("");
    setSearchInputValue("");
    setSelectedCommittees([]);
  }

  function handleSubmitSearch(event?: React.FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    setSearchTerm(searchInputValue);
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
      }}
    >
      {children}
    </SearchFilterContext.Provider>
  );
}

export function useSearchFilter(): SearchFilterContextType {
  const context = useContext(SearchFilterContext);
  if (context === undefined)
    throw new Error("useSearch must be used within a SearchProvider");
  return context;
}
