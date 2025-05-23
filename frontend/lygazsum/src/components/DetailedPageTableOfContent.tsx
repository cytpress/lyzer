import { TocEntry } from "../types/models";

interface TableOfContentsProps {
  entries: TocEntry[];
}

export function DetailedPageTableOfContent({ entries }: TableOfContentsProps) {
  return (
    <nav className="w-full lg:w-1/4 shrink-0 p-4 lg:p-6 hidden lg:block sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
      <h3 className="font-semibold text-slate-700 mb-3">在本頁中</h3>
      <ul>
        {entries?.map((entry) => {
          return (
            <>
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            </>
          );
        })}
      </ul>
    </nav>
  );
}
