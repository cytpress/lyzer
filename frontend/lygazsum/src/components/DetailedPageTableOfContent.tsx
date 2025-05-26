import { TocEntry } from "../types/models";

interface TableOfContentsProps {
  entries: TocEntry[];
  activeId: string | null;
}

export function DetailedPageTableOfContent({
  entries,
  activeId,
}: TableOfContentsProps) {
  return (
    <nav className="w-full lg:w-1/4 shrink-0 p-4 lg:p-6 hidden lg:block sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
      <h3 className="font-semibold text-slate-700 mb-3">在本頁中</h3>
      <ul>
        {entries?.map((entry) => {
          return (
            <li key={`toc-${entry.id}`}>
              <a
                href={`#${entry.id}`}
                className={
                  entry.id === activeId ? "text-blue-600 " : "deactivated"
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
