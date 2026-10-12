import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * pdf.js reads fonts, character maps and image decoders at run time. An
 * extension may not load code or data from the network, so they ship inside it.
 */
function copyPdfjsAssets(): Plugin {
  return {
    name: "copy-pdfjs-assets",
    closeBundle() {
      for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
        cpSync(
          resolve(__dirname, "node_modules/pdfjs-dist", dir),
          resolve(__dirname, "dist/pdfjs", dir),
          { recursive: true },
        );
      }
    },
  };
}

// Chrome loads the extension from dist/. Pages keep their own HTML; the
// background service worker is emitted as background.js next to manifest.json.
export default defineConfig({
  base: "",
  plugins: [copyPdfjsAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        editor: resolve(__dirname, "editor.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
