import { TocEntry } from "@/types/models";

interface TableOfContentsProps {
  entries: TocEntry[];
  activeId: string | null;
  expandedGroupIds: string[];
  isOpen: boolean;
  onClose: () => void;
}

export function DetailedPageTableOfContent({
  entries,
  activeId,
  expandedGroupIds,
  isOpen,
  onClose,
}: TableOfContentsProps) {
  const mobileTocShouldBeWider =
    activeId &&
    (activeId.includes("speaker") ||
      activeId.includes("legislators-speech") ||
      activeId.includes("respondents-response"));

  const mobileTocWidth = mobileTocShouldBeWider ? "w-4/5" : "w-2/5";

  const mobileTocClasses = `fixed top-0 right-0 h-full ${mobileTocWidth} max-w-xs bg-white z-50 p-6 overflow-y-auto shadow-xl ${
    isOpen ? "transform-none" : "translate-x-full"
  }`;

  const mdTocCLasses =
    "md:w-1/3 md:shrink-0 md:pt-14 md:pl-8 md:pb-10 md:block md:sticky md:top-18 md:h-[calc(100vh-4rem)] md:overflow-y-auto md:border-l md:border-neutral-300 md:translate-x-0";

  const resetClasses =
    "md:bg-transparent md:shadow-none md:p-0 md:border-l md:border-neutral-300 md:z-auto";
  return (
    <>
      <div
        className={`md:hidden fixed inset-0 z-50 bg-neutral-50/50 transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <nav
        className={`transition-[width, transform] duration-300 ease-in-out ${mobileTocClasses} ${mdTocCLasses} ${resetClasses}`}
      >
        <h3 className="font-semibold text-neutral-500 mb-3">在本頁中</h3>

        <ul>
          {entries?.map((entry) => {
            if (entry.type === "divider") {
              return (
                <li key={entry.id}>
                  <hr className="my-3 border-neutral-200" />
                </li>
              );
            }

            const isExpanded = expandedGroupIds.includes(entry.id);

            return (
              <li key={entry.id} className="p-2">
                <a
                  href={`#${entry.id}`}
                  className={
                    entry.id === activeId
                      ? " text-neutral-900 font-medium"
                      : " text-neutral-600"
                  }
                >
                  {entry.text}
                </a>
                {entry.children && entry.children.length > 0 && (
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
