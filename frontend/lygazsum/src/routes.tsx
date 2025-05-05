import App from "./App";
import { createBrowserRouter } from "react-router-dom";

export const routesConfig = createBrowserRouter([
  { path: "/", element: <App />, children: [] },
]);
