import { TocEntry } from "../types/models";

interface TableOfContentsProps {
  entries: TocEntry[];
  activeId: string | null;
}

export function DetailedPageTableOfContent({
  entries,
  activeId,
}: TableOfContentsProps) {
  const indentClasses = "pl-6 p-2";
  return (
    <nav className="w-full lg:w-1/3 shrink-0 pt-14 pl-6 hidden lg:block sticky top-18 h-[calc(100vh-4rem)] overflow-y-auto border-l border-neutral-300">
      <h3 className="font-semibold text-neutral-500 mb-3">在本頁中</h3>
      <ul>
        {entries?.map((entry) => {
          return (
            <li
              key={`toc-${entry.id}`}
              className={entry.level === 2 ? indentClasses : "p-2"}
            >
              <a
                href={`#${entry.id}`}
                className={
                  entry.id === activeId
                    ? "text-neutral-900 font-medium"
                    : "text-neutral-600"
                }
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
