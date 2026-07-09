import React from "react";
import ReactDOM from "react-dom/client";
import { AppProvider } from "./store";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

if (import.meta.env.DEV) {
  const { default: axe } = await import("@axe-core/react");
  axe(React, ReactDOM, 1000);
}
