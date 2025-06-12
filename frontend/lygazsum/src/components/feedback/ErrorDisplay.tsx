interface ErrorDisplayProps {
  errorMessage: string;
  onRetry: () => void;
}

export function ErrorDisplay({ errorMessage, onRetry }: ErrorDisplayProps) {
  return (
    <div className="flex flex-col w-3/5 mx-auto items-center justify-center min-h-[calc(100vh-180px)]">
      <div>
        <h3 className="text-neutral-900 text-2xl md:text-3xl font-semibold mb-2 md:mb-4 mt-10">
          這手有點問題......
        </h3>
        <p className="text-neutral-900 text-base leading-[180%] md:leading-relaxed mb-2">
          看來我們出現了一點問題，可以的話請透過關於本站中的表單，將錯誤的訊息以及如何造成錯誤告訴我。
        </p>
        <p className="text-neutral-600 text-base leading-[180%] md:leading-relaxed mb-2">
          錯誤訊息：{errorMessage}
        </p>
        <div>
          <div className="flex flex-row justify-end">
            <button
              onClick={onRetry}
              className="rounded-xl px-5 py-2 text-neutral-700 hover:text-neutral-900 border-2 border-neutral-500 hover:border-neutral-800 transition-colors"
            >
              再試一次
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
