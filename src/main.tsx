import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css"; // <-- BU SATIR ŞART

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
