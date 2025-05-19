import "./App.css";
import { Outlet } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";

function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteHeader />
      <main className="flex-grow container mx-auto px-4 py-6">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export default App;
