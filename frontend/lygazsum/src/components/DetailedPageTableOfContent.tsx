import { TocEntry } from "@/types/models";

interface TableOfContentsProps {
  entries: TocEntry[]; // 目錄條目數據
  activeId: string | null; // 當前高亮的條目 ID
  expandedGroupIds: string[]; // 當前應展開的父級條目 ID 列表
  isOpen: boolean; // 控制行動版 TOC 的開合
  onClose: () => void; // 關閉行動版 TOC 的函式
}

/**
 * 頁面目錄 (Table of Contents) 元件
 * 在桌面版顯示為右側邊欄，在行動版則為可開合的抽屜。
 * 負責渲染目錄結構，並處理點擊跳轉和高亮顯示。
 *
 * @param {TableOfContentsProps} props
 */
export function DetailedPageTableOfContent({
  entries,
  activeId,
  expandedGroupIds,
  isOpen,
  onClose,
}: TableOfContentsProps) {
  /**
   * 處理目錄條目的點擊事件。
   * 實現平滑滾動到對應的錨點，並更新 URL hash。
   * @param {React.MouseEvent<HTMLAnchorElement>} event - 點擊事件。
   * @param {string} targetId - 目標元素的 ID。
   */
  function handleTocClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    targetId: string
  ) {
    event.preventDefault(); // 阻止 <a> 標籤的預設跳轉行為

    const targetElement = document.getElementById(targetId);

    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      // 手動更新 URL 的 hash，讓使用者可以複製帶有錨點的連結。
      window.history.pushState(null, "", `#${targetId}`);
    }
  }

  // 在行動裝置上，如果當前高亮的條目是發言者相關的（立法委員或相關人員回覆），則讓 TOC 更寬。
  const mobileTocShouldBeWider =
    activeId &&
    (activeId.includes("speaker") ||
      activeId.includes("legislators-speech") ||
      activeId.includes("respondents-response"));

  // 行動版 TOC 擴展寬度與一般寬度
  const mobileTocWidth = mobileTocShouldBeWider ? "w-4/5" : "w-2/5";

  // 行動版 TOC 的樣式（抽屜效果）
  const mobileTocClasses = `fixed top-0 right-0 h-full ${mobileTocWidth} max-w-xs bg-white z-50 p-6 overflow-y-auto shadow-xl ${
    isOpen ? "transform-none" : "translate-x-full"
  }`;

  // 桌面版 TOC 的樣式（固定側邊欄）
  const mdTocCLasses =
    "md:w-1/3 md:shrink-0 md:pt-14 md:pl-8 md:pb-10 md:block md:sticky md:top-18 md:h-[calc(100vh-4rem)] md:overflow-y-auto md:border-l md:border-neutral-300 md:translate-x-0";

  // 在桌面版重置行動版的樣式，用於可能從直式變成橫式等造成寬度大於md的行為
  const resetClasses =
    "md:bg-transparent md:shadow-none md:p-0 md:border-l md:border-neutral-300 md:z-auto";
  return (
    <>
      {/* 行動版 overlay，點擊可關閉 TOC */}
      <div
        className={`md:hidden fixed inset-0 z-50 bg-neutral-50/50 transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* TOC 主體 */}
      <nav
        className={`transition-[width, transform] duration-300 ease-in-out ${mobileTocClasses} ${mdTocCLasses} ${resetClasses}`}
      >
        <h3 className="font-semibold text-neutral-500 mb-3">在本頁中</h3>

        <ul>
          {entries?.map((entry) => {
            // 如果條目類型是 'divider'，渲染一條分隔線
            if (entry.type === "divider") {
              return (
                <li key={entry.id}>
                  <hr className="my-3 border-neutral-200" />
                </li>
              );
            }

            // 檢查此父級條目是否應被展開
            const isExpanded = expandedGroupIds.includes(entry.id);

            return (
              <li key={entry.id} className="p-2">
                <a
                  onClick={(e) => {
                    handleTocClick(e, entry.id);
                  }}
                  href={`#${entry.id}`}
                  className={
                    entry.id === activeId
                      ? " text-neutral-900 font-medium"
                      : " text-neutral-600"
                  }
                >
                  {entry.text}
                </a>

                {/* 如果有子項目，則渲染它們 */}
                {entry.children && entry.children.length > 0 && (
                  // 使用 grid-template-rows 實現平滑的展開/收合動畫
                  <div
                    className={`grid transition-[grid-template-rows] duration-500 ease-in-out ${
                      isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <ul className="overflow-hidden">
                      {entry.children?.map((childEntry) => {
                        return (
                          <li key={childEntry.id} className="pl-6 pt-4">
                            <a
                              onClick={(e) => {
                                handleTocClick(e, childEntry.id);
                              }}
                              href={`#${childEntry.id}`}
                              className={
                                childEntry.id === activeId
                                  ? "text-neutral-900 font-medium"
                                  : "text-neutral-600"
                              }
                            >
                              {childEntry.text}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
