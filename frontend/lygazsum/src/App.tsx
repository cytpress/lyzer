import "./App.css";
import { Outlet } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { SearchProvider } from "./context/searchContext";

function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <SearchProvider>
        <SiteHeader />
        <main className="flex-grow container mx-auto px-4">
          <Outlet />
        </main>
        <SiteFooter />
      </SearchProvider>
    </div>
  );
}

export default App;
