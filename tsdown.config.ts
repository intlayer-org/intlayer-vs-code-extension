import { mkdir, cp, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);

/**
 * Helper to copy a folder into a specific subfolder of dist/assets
 */
async function copyPackageAssets(
  pkgName: string,
  subDirName: string,
  destRoot: string
) {
  try {
    // Locate the package's root
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    const pkgRoot = dirname(pkgJsonPath);

    // Assume assets are in dist/assets or just assets (adjust if needed)
    const srcAssets = resolve(pkgRoot, "dist/assets");
    const destAssets = resolve(destRoot, subDirName);

    // Copy recursively
    await mkdir(destAssets, { recursive: true });
    await cp(srcAssets, destAssets, { recursive: true });

    console.log(`✓ Copied assets: ${pkgName} -> dist/assets/${subDirName}`);
  } catch (error) {
    console.warn(
      `! Could not copy assets for ${pkgName} (it might not have any):`,
      error.message
    );
  }
}

export default defineConfig({
  entry: {
    extension: "./src/extension.ts",
  },
  format: "cjs",
  target: "node20",
  clean: true,
  platform: "node",
  minify: true,
  sourcemap: true,

  // Bundle everything
  noExternal: [/(.*)/],
  external: ["vscode", "esbuild", "fsevents"],

  alias: {
    "@intlayer/config/built": resolve("src/config-built.ts"),
    // Redirect alias to local if used directly in source
    "utils:asset": resolve("src/utils/assets.ts"),
  },

  plugins: [
    /**
     * PLUGIN 1: Asset Loader Patch
     * Intercepts the internal virtual module used by @intlayer packages.
     * Injects a "Smart Search" readAsset function.
     */
    {
      name: "patch-asset-loader",
      transform(code, id) {
        // Match the virtual file path used inside @intlayer dependencies
        if (/[\\/]_virtual[\\/]_utils_asset\.(mjs|cjs|js)$/.test(id)) {
          console.log(`⚡ Patching asset loader in: ${basename(id)}`);

          return `
            import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
            import { join, basename } from 'node:path';

            // Recursive function to find a file in a directory tree
            function findFile(root, filename) {
              if (!existsSync(root)) return null;
              
              const entries = readdirSync(root);
              
              // Check current level
              if (entries.includes(filename)) {
                return join(root, filename);
              }
              
              // Search subdirectories
              for (const entry of entries) {
                const fullPath = join(root, entry);
                if (statSync(fullPath).isDirectory()) {
                  const found = findFile(fullPath, filename);
                  if (found) return found;
                }
              }
              return null;
            }

            export const readAsset = (relPath, encoding = 'utf8') => {
              const fileName = basename(relPath);
              const assetsRoot = join(__dirname, 'assets');

              // Search for the file anywhere inside dist/assets
              const foundPath = findFile(assetsRoot, fileName);

              if (!foundPath) {
                 throw new Error(\`Asset not found: \${fileName} (searched in \${assetsRoot})\`);
              }

              return readFileSync(foundPath, encoding);
            };
          `;
        }
        return null;
      },
    },

    /**
     * PLUGIN 2: Explicit Copy
     * Copies known dependency assets to dist/assets/SUBFOLDER
     */
    {
      name: "copy-dependency-assets",
      async writeBundle() {
        const destRoot = resolve("dist/assets");

        // Copy your local HTML (not flattened, stays in dist root as per your request)
        await cp(
          resolve("src/explorer/searchInput.html"),
          resolve("dist/searchInput.html")
        ).catch(() => {});

        // Copy dependencies into namespaced folders to avoid collisions
        await copyPackageAssets("@intlayer/chokidar", "chokidar", destRoot);
        await copyPackageAssets("@intlayer/cli", "cli", destRoot);
        await copyPackageAssets("@intlayer/ai", "ai", destRoot);
      },
    },
  ],
});
