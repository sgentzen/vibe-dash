import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:3001",
      // MCP Streamable HTTP. The dashboard itself never calls this, but proxying it
      // means an MCP client pointed at the dev URL (:3000) reaches the same endpoint
      // as one pointed at the backend (:3001) instead of 404ing.
      "/mcp": {
        target: "http://localhost:3001",
        // Streamable HTTP replies with SSE; buffering would stall the stream.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        },
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
