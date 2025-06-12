export function GazetteListItemSkeleton() {
  return (
    <li className="w-11/12 md:w-4/5 mx-auto">
      <div className="flex flex-col justify-center px-4 py-4 md:px-8 md:py-8 border-2 rounded-3xl border-neutral-200  bg-white animate-pulse">
        <div className="h-7 w-4/5 rounded-md mb-2 bg-neutral-200"></div>
        <div className="h-5 w-2/6 rounded-md mb-2 bg-neutral-200"></div>
        <div className="space-y-2">
          <div className="h-4 bg-neutral-200 rounded-md"></div>
          <div className="h-4 bg-neutral-200 rounded-md"></div>
        </div>
      </div>
    </li>
  );
}
