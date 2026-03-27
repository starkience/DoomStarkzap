import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Stub optional peer deps that starkzap references but we don't use
      "@fatsolutions/tongo-sdk": path.resolve(__dirname, "src/stubs/tongo-sdk.ts"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/ws": {
        target: "ws://localhost:8001",
        ws: true,
      },
      "/lobby": {
        target: "ws://localhost:8001",
        ws: true,
      },
    },
  },
});
