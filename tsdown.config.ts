import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    extension: "./src/extension.ts",
  },
  format: "cjs", // VS Code extensions typically run as CommonJS
  target: "node20", // Aligns with recent VS Code Node.js versions
  clean: true, // Clean dist folder before build
  platform: "node",
  minify: true,
  sourcemap: true,
  // usage of dts is optional for the final extension bundle, usually not needed for runtime
  dts: false,
  // Ensure 'vscode' is treated as an external module provided by the host
  external: ["vscode"],
  // Resolve path aliases (from tsconfig) at build time
  alias: {
    "@intlayer/config/built": "./dist/config-built.js",
  },
  plugins: [
    {
      name: "copy-assets",
      async writeBundle() {
        await mkdir(resolve("dist/explorer"), { recursive: true });
        await copyFile(
          resolve("src/explorer/searchInput.html"),
          resolve("dist/searchInput.html")
        );
      },
    },
  ],
});
