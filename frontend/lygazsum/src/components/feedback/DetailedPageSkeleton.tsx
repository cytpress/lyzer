export function DetailedPageSkeleton() {
  return (
    <div className="flex flex-row px-6 mb-10 md:px-20 animate-pulse">
      <div className="w-full md:w-2/3 pt-10 md:mr-12 space-y-6 md:space-y-10">
        <div className="flex flex-col">
          <div className="h-10 w-full mb-2 rounded-md bg-neutral-200"></div>
          <div className="h-10 w-3/5 mb-6 rounded-md bg-neutral-200"></div>
          <div className="h-5 w-full mb-2 rounded-md bg-neutral-200"></div>
          <div className="h-5 w-full mb-2 rounded-md bg-neutral-200"></div>
          <div className="h-5 w-full mb-2 rounded-md bg-neutral-200"></div>
          <div className="h-5 w-3/5 mb-2 rounded-md bg-neutral-200"></div>
        </div>
        <div className="flex flex-col">
          <div className="h-7 w-24 mb-4 rounded-md bg-neutral-200"></div>
          <div className="h-5 w-full mb-2 rounded-md bg-neutral-200"></div>
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="flex flex-col" key={index}>
            <div className="h-7 w-24 mb-4 rounded-md bg-neutral-200"></div>
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                className="h-5 w-full pl-8 mb-2 rounded-md bg-neutral-200"
                key={index}
              ></div>
            ))}
          </div>
        ))}
      </div>
      <div></div>
    </div>
  );
}
