import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path"; // Ensure this is imported
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    extension: "./src/extension.ts",
  },
  format: "cjs",
  target: "node20",
  clean: true,
  platform: "node",
  minify: true,

  // Force bundling of all dependencies so it works in VS Code
  noExternal: [/(.*)/],

  sourcemap: true,
  dts: false,
  external: ["vscode", "esbuild", "fsevents"],

  alias: {
    // ⚠️ FIX: Wrap this in resolve() to make it an absolute path
    "@intlayer/config/built": resolve("src/config-built.ts"),
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
