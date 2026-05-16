import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/query":         "http://localhost:8000",
      "/graph":         "http://localhost:8000",
      "/chat":          "http://localhost:8000",
      "/edge-summary":  "http://localhost:8000",
      "/expand":        "http://localhost:8000",
      "/redetect-gaps": "http://localhost:8000",
      "/voice":         "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
