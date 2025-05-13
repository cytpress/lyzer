import "./App.css";
import { Outlet } from "react-router-dom";

function App() {
  return (
    <div>
      <header></header>
      <main>
        <Outlet />
      </main>
      <footer></footer>
    </div>
  );
}

export default App;
