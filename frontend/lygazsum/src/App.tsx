//frontend/lygazsum/src/App.tsx

import { Outlet, ScrollRestoration } from "react-router-dom";
import { SiteHeader } from "./components/layout/SiteHeader";
import { SiteFooter } from "./components/layout/SiteFooter";
import { SearchProvider } from "./context/SearchFilterContext";
import { useScrollbarVisibility } from "./hooks/useScrollbarVisibility";

/**
 * App.tsx 主要職責：
 * 1. 使用 `SearchProvider` 將搜尋和篩選的狀態提供給所有子元件。
 * 2. 渲染固定的 `SiteHeader` 和 `SiteFooter`。
 * 3. 使用 `Outlet` 來渲染當前路由匹配的頁面元件。
 * 4. 使用 `ScrollRestoration` 來處理路由切換時的滾動位置，以便使用者在切換頁面時，都能回到頁面頂端，以確保使用者體驗。
 * 5. 呼叫 `useScrollbarVisibility` 自定義 Hook 讓行動裝置(w<md)捲動時，捲動條會自動隱藏。
 */

function App() {
  useScrollbarVisibility();

  return (
    <div className="flex flex-col min-h-dvh bg-neutral-50">
      <SearchProvider>
        <SiteHeader />
        <main className="container max-w-7xl mx-auto flex-grow">
          <Outlet />
        </main>
        <SiteFooter />
        <ScrollRestoration />
      </SearchProvider>
    </div>
  );
}

export default App;
