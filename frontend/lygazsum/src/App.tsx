import { Outlet } from "react-router-dom";
import { SiteHeader } from "./components/layout/SiteHeader";
import { SiteFooter } from "./components/layout/SiteFooter";
import { SearchProvider } from "./context/SearchFilterContext";
import { useScrollbarVisibility } from "./hooks/useScrollbarVisibility";

function App() {
  useScrollbarVisibility();
  return (
    <div className="flex flex-col min-h-dvh bg-neutral-50">
      <SearchProvider>
        <div className="flex-grow overflow-y-auto scroll-smooth">
          <SiteHeader />
          <main className="container max-w-7xl mx-auto flex-grow">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
      </SearchProvider>
    </div>
  );
}

export default App;
