import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/wh-mapper/api/": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
      "/ws/wh-mapper/": {
        target: "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    manifest: true,
    outDir: "build/static/",
    rollupOptions: {
      output: {
        // Nested under "static/" so copy-assets.sh can drop it straight into
        // wh_mapper/static/wh_mapper/static/ (BASE_URL already supplies the
        // "wh_mapper" segment - don't repeat it here or URLs double up).
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? "asset";
          let extType = name.split(".").at(-1) ?? "asset";
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
            extType = "img";
          }
          return `static/${extType}/[name]-[hash][extname]`;
        },
      },
    },
  },
});
