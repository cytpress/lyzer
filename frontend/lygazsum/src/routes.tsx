import App from "./App";
import { createBrowserRouter } from "react-router-dom";
import Homepage from "./pages/Homepage";
import DetailedGazettePage from "./pages/DetailedGazettePage";

export const routesConfig = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <Homepage />,
      },
      {
        path: "/detailedGazette/:id",
        element: <DetailedGazettePage />,
      },
    ],
  },
]);
