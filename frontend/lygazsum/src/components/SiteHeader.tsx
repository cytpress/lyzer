import { Link } from "react-router-dom";

export function SiteHeader() {
  return (
    <header className="sticky top-0 bg-amber-200 h-16 z-50 content-center">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center ">
        <Link to="/" className="flex flex-row items-center space-x-4">
          <img src="/vite.svg" alt="placeholder" className="h-8 w-auto" />
          <p>LZY 立院公報懶人包</p>
        </Link>

        <div className="flex items-center space-x-4">
          <input
            type="text"
            placeholder="搜尋..."
            className="px-3 py-1.5 rounded-md text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hidden md:block"
          />
          <nav>
            <ul className="flex space-x-4">
              <li>
                <Link to="/about" className="...">
                  關於本站
                </Link>
              </li>
              <li>
                <Link to="/contact" className="...">
                  聯絡我
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
}
