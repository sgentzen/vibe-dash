import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Normally the api server is :3001 (see CLAUDE.md's PORT default). e2e runs
// override this via VIBE_DASH_API_PORT (set in playwright.config.ts) so the
// dev-mode proxy follows the dedicated, isolated port the e2e run's express
// server actually listens on instead of the real :3001 instance.
const apiPort = process.env.VIBE_DASH_API_PORT ?? "3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      // MCP Streamable HTTP. The dashboard itself never calls this, but proxying it
      // means an MCP client pointed at the dev URL (:3000) reaches the same endpoint
      // as one pointed at the backend (:apiPort) instead of 404ing.
      "/mcp": {
        target: `http://localhost:${apiPort}`,
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
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
});
