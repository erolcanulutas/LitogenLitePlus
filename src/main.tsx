import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css"; // <-- BU SATIR ŞART

// The home page lab lives at /lab and shares nothing with the studio but its
// styles; it is fetched only by whoever goes there.
const Lab = lazy(() => import("./lab/LabApp"));
const inLab = /^\/lab\/?$/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {inLab ? (
      <Suspense fallback={null}>
        <Lab />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
