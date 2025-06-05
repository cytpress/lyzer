import "./App.css";
import { Outlet } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { SearchProvider } from "./context/SearchFilterContext";

function App() {
  return (
    <div className="flex flex-col min-h-screen bg-neutral-50">
      <SearchProvider>
        <SiteHeader />
        <main className="flex-grow container max-w-7xl mx-auto ">
          <Outlet />
        </main>
        <SiteFooter />
      </SearchProvider>
    </div>
  );
}

export default App;
