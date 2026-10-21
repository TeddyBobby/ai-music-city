import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "/static/dist/",
  build: { outDir: "../yue2_studio/static/dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.origin === `http://${req.headers.host}`)
              proxyReq.setHeader("origin", "http://127.0.0.1:8765");
          });
        },
      },
      "/static/assets": "http://127.0.0.1:8765",
    },
  },
});
