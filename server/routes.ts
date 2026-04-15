// Re-export from the new routes/ directory for backward compatibility.
// All route logic has been split into domain-specific modules under server/routes/.
export { createRouter } from "./routes/index.js";
