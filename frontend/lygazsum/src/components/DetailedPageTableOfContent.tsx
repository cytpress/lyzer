import { TocEntry } from "../types/models";

interface TableOfContentsProps {
  entries: TocEntry[];
  activeId: string | null;
  expandedGroupIds: string[];
}

export function DetailedPageTableOfContent({
  entries,
  activeId,
  expandedGroupIds,
}: TableOfContentsProps) {
  return (
    <nav className="w-full lg:w-1/3 shrink-0 pt-14 pl-8 pb-10 hidden lg:block sticky top-18 h-[calc(100vh-4rem)] overflow-y-auto border-l border-neutral-300">
      <h3 className="font-semibold text-neutral-500 mb-3">在本頁中</h3>
      <ul>
        {entries?.map((entry) => {
          const isExpanded = expandedGroupIds.includes(entry.id);
          return (
            <li key={`toc-parent-${entry.id}`} className="p-2">
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
                        <li key={`toc-child-${entry.id}`} className="pl-6 pt-4">
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
  );
}
