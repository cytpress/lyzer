import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom";
import {
  ExclamationTriangleIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";

export default function ErrorPage() {
  const error = useRouteError();
  console.error(error);

  let errorTitle = "糟糕，發生了未知的錯誤！";
  let errorMessage = "很抱歉，我們的網站出現了一些問題。";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      errorTitle = "404 - 找不到頁面";
      errorMessage = "您想找的頁面不存在，它可能已被移動或刪除。";
    } else {
      errorTitle = `錯誤 ${error.status}`;
      errorMessage = error.statusText || "發生了一個 HTTP 錯誤。";
    }
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 text-center px-6">
      <ExclamationTriangleIcon className="h-16 w-16 text-yellow-500 mb-4" />
      <h1 className="text-4xl font-bold text-neutral-800">{errorTitle}</h1>
      <p className="mt-4 max-w-lg text-neutral-600">{errorMessage}</p>
      <div className="mt-10">
        <Link
          to="/"
          className="inline-flex gap-x-2 rounded-xl px-5 py-2 text-neutral-700 hover:text-neutral-900 border-2 border-neutral-500 hover:border-neutral-800 transition-colors"
        >
          <ArrowUturnLeftIcon className="h-5 w-5" />
          返回首頁
        </Link>
      </div>
    </div>
  );
}
