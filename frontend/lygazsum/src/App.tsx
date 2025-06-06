import { Outlet } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { SearchProvider } from "./context/SearchFilterContext";
import { useRef, createContext, RefObject } from "react";

export const ScrollContainerContext =
  createContext<RefObject<HTMLDivElement | null> | null>(null);

function App() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col h-screen bg-neutral-50">
      <SearchProvider>
        <ScrollContainerContext.Provider value={scrollContainerRef}>
          <div
            ref={scrollContainerRef}
            className="flex-grow overflow-y-auto scroll-smooth"
          >
            <SiteHeader />
            <main className="container max-w-7xl mx-auto">
              <Outlet />
            </main>
            <SiteFooter />
          </div>
        </ScrollContainerContext.Provider>
      </SearchProvider>
    </div>
  );
}

export default App;
