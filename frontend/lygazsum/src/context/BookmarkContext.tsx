import {
  createContext,
  useState,
  ReactNode,
  useEffect,
  useContext,
} from "react";

// 用於 localStorage 儲存公報id
const BOOKMARKS_STORAGE_KEY = "lyzer-bookmarks";

interface BookmarkContextType {
  bookmarkedIds: string[];
  isBookmarked: (id: string) => boolean;
  handleBookmarkToggle: (id: string) => void;
}

const BookmarkContext = createContext<BookmarkContextType | undefined>(
  undefined
);

interface BookmarkProviderProps {
  children: ReactNode;
}

export function BookmarkProvider({ children }: BookmarkProviderProps) {
  // 先抓取 localStorage 中 id 列表，若無則返回空陣列
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => {
    try {
      const storedIds = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
      return storedIds ? JSON.parse(storedIds) : [];
    } catch (error) {
      console.error("無法從 localStorage 中解析書籤id", error);
      return [];
    }
  });

  // 根據 id 列表，將 id 存入 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        BOOKMARKS_STORAGE_KEY,
        JSON.stringify(bookmarkedIds)
      );
    } catch (error) {
      console.error("Failed to save bookmarks to localStorage", error);
    }
  }, [bookmarkedIds]);

  // 判斷列表中是否含有 id，作為後續顯示 "加入收藏" 或 "取消收藏" 以及其 function
  function isBookmarked(id: string) {
    return bookmarkedIds.includes(id);
  }

  function addBookmark(id: string) {
    setBookmarkedIds((prevIds) => {
      const newIds = new Set([...prevIds, id]);
      return Array.from(newIds);
    });
  }

  function removeBookmark(id: string) {
    setBookmarkedIds((prevIds) =>
      prevIds.filter((currentId) => currentId !== id)
    );
  }

  function handleBookmarkToggle(id: string) {
    if (isBookmarked(id)) {
      removeBookmark(id);
    } else {
      addBookmark(id);
    }
  }

  return (
    <BookmarkContext.Provider
      value={{
        bookmarkedIds,
        isBookmarked,
        handleBookmarkToggle,
      }}
    >
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmark(): BookmarkContextType {
  const context = useContext(BookmarkContext);
  if (context === undefined) {
    throw new Error(" useBookmark 必須在 bookmarkProvider 中使用");
  }
  return context;
}
