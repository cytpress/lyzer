import { createContext, useState, ReactNode, useContext } from "react";

interface SearchFilterContextType {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedCommittees: string[];
  handleCommitteesToggle: (committeeName: string) => void;
}

const SearchFilterContext = createContext<SearchFilterContextType | undefined>(
  undefined
);

interface SearchProviderProps {
  children: ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([]);

  function handleCommitteesToggle(committeeName: string) {
    setSelectedCommittees((prevList) => {
      if (!selectedCommittees.includes(committeeName)) {
        return [...prevList, committeeName];
      } else {
        return prevList.filter((committee) => committee !== committeeName);
      }
    });
  }

  return (
    <SearchFilterContext.Provider
      value={{
        searchTerm,
        setSearchTerm,
        selectedCommittees,
        handleCommitteesToggle,
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
