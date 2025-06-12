import { useSearchFilter } from "../../context/SearchFilterContext";

export function EmptyStateDisplay() {
  const { searchTerm, selectedCommittees, clearFilterAndSearchTerm } =
    useSearchFilter();

  if (!searchTerm && !selectedCommittees) {
    return (
      <div className="flex flex-col w-3/5 mx-auto items-center justify-center min-h-[calc(100vh-180px)]">
        <p className="text-neutral-900 text-base leading-[180%] md:leading-relaxed mb-2">
          資料空空如也！
        </p>
      </div>
    );
  }

  if (searchTerm || selectedCommittees) {
    return (
      <div className="flex flex-col w-3/5 mx-auto items-center justify-center min-h-[calc(100vh-180px)]">
        <h3 className="text-neutral-900 text-xl leading-[180%] md:leading-relaxed mb-4">
          查無符合搜尋或篩選的資料
        </h3>
        <button
          onClick={clearFilterAndSearchTerm}
          className="rounded-xl px-5 py-2 text-neutral-700 hover:text-neutral-900 border-2 border-neutral-500 hover:border-neutral-800 transition-colors"
        >
          清除搜尋和篩選
        </button>
      </div>
    );
  }
}
