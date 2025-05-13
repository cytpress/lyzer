import App from "./App";
import { createBrowserRouter } from "react-router-dom";
import HomePage from "./pages/HomePage";

export const routesConfig = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
    ],
  },
]);
