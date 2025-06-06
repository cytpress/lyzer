import App from "./App";
import { createBrowserRouter } from "react-router-dom";
import HomePage from "./pages/Homepage";
import DetailedGazettePage from "./pages/DetailedGazettePage";

export const routesConfig = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "/detailedGazette/:id",
        element: <DetailedGazettePage />,
      },
    ],
  },
]);
