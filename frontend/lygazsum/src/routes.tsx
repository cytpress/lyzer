import App from "./App";
import { createBrowserRouter } from "react-router-dom";
import Homepage from "./pages/Homepage";
import DetailedGazettePage from "./pages/DetailedGazettePage";
import AboutPage from "./pages/AboutPage";
import ErrorPage from "./pages/ErrorPage";

export const routesConfig = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <Homepage />,
      },
      {
        path: "/detailedGazette/:id",
        element: <DetailedGazettePage />,
      },
      {
        path: "/about",
        element: <AboutPage />,
      },
    ],
  },
]);
