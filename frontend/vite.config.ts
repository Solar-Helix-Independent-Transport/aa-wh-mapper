import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Must match wh_mapper/templates/wh_mapper/index.html's BASE_URL
  // ("{% static 'wh_mapper/' %}", which resolves to STATIC_URL + "wh_mapper/"
  // - "/static/wh_mapper/" for this project's STATIC_URL). That template
  // loads the entry JS/CSS itself by manually prepending BASE_URL to
  // manifest.json's paths, bypassing this `base` entirely - but any asset
  // referenced via a plain ES import in React source (e.g. AppBrand's logo)
  // gets Vite's own baked-in URL instead, which is this `base` + the
  // asset's build path. Without this set, that defaults to "/" and never
  // matches where copy-assets.sh actually puts the file, so the browser
  // requests the wrong URL and the image 404s - the JS/CSS chunks still
  // loaded fine because *they* don't depend on this setting at all.
  base: "/static/wh_mapper/",
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
        // wh_mapper/static/wh_mapper/static/ - relative to outDir, same as
        // every other rollup output path, and NOT affected by `base` above
        // (that only changes how *references* to these files get written
        // into the compiled JS/CSS/HTML, not where rollup emits them or
        // what manifest.json's own paths say).
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
