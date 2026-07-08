import { config } from "dotenv";
config();

// Global error handlers to prevent crashes
process.on("unhandledRejection", (reason, promise) => {
  console.warn("[UnhandledRejection] Promise rejected with reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UncaughtException] Uncaught exception:", error);
  process.exit(1);
});

import "./jellyfin"
import "./webserver"