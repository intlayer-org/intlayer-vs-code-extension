import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);

/**
 * Helper to copy a folder into a specific subfolder of dist/assets
 */
async function copyPackageAssets(
  pkgName: string,
  subDirName: string,
  destRoot: string,
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
      (error as Error).message,
    );
  }
}

const sharedDeps = {
  alwaysBundle: [/(.*)/],
  onlyBundle: false as const,
  neverBundle: [
    "vscode",
    "esbuild",
    "picocolors",
    "@intlayer/ai",
    "fsevents",
    // oxc-parser ships platform-specific native binaries — cannot be inlined
    "oxc-parser",
    "@oxc-parser/binding-darwin-arm64",
    "@oxc-parser/binding-darwin-x64",
    "@oxc-parser/binding-linux-x64-gnu",
    "@oxc-parser/binding-win32-x64-msvc",
    "node:fs",
    "node:fs/promises",
    "node:path",
    "node:module",
    "node:child_process",
  ],
};

const sharedAlias = {
  // @intlayer/config has no bare "." export — redirect to /node (Node.js env).
  // Needed by @intlayer/lsp which imports the bare specifier.
  "@intlayer/config": resolve(
    "node_modules/@intlayer/config/dist/esm/node.mjs",
  ),
  // Point @intlayer/lsp/utils to the local monorepo source so the extension
  // host picks up the Oxc-based AST helpers without requiring a publish.
  "@intlayer/lsp/utils": resolve(
    "node_modules/@intlayer/lsp/dist/esm/utils.mjs",
  ),
  "utils:asset": resolve("src/utils/assets.ts"),
};

// Extension-only alias: redirect @intlayer/config/built to the VS Code–aware
// implementation (uses the vscode API to load config per active editor).
// Must NOT be applied to the LSP server build, which runs in a plain Node
// process where `vscode` is unavailable.
const extensionAlias = {
  ...sharedAlias,
  "@intlayer/config/built": resolve("src/config-built.ts"),
};

export default defineConfig([
  // ── Extension host process ────────────────────────────────────────────────
  {
    entry: {
      extension: "./src/extension.ts",
    },
    format: "cjs",
    outExtensions: () => ({ js: ".js" }),
    target: "node20",
    clean: true,
    platform: "node",
    minify: true,
    treeshake: true,
    sourcemap: false,

    deps: sharedDeps,
    alias: extensionAlias,

    plugins: [
      /**
       * PLUGIN: Asset Loader Patch
       * Intercepts the internal virtual module used by @intlayer packages.
       * Injects a "Smart Search" readAsset function.
       */
      {
        name: "patch-asset-loader",
        transform(_code, id) {
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
            resolve("dist/searchInput.html"),
          ).catch(() => {});

          // Copy dependencies into namespaced folders to avoid collisions
          await copyPackageAssets("@intlayer/chokidar", "chokidar", destRoot);
          await copyPackageAssets("@intlayer/cli", "cli", destRoot);
          await copyPackageAssets("@intlayer/ai", "ai", destRoot);
        },
      },
    ],
  },

  // LSP server process
  // Bundled separately so it can run as a forked child process.
  // treeshake is disabled because @intlayer/lsp declares "sideEffects: false"
  // even though the server runs entirely through top-level side effects
  // (connection.listen(), documents.listen(), …).
  {
    entry: { "lsp-server": "./src/lsp-server.ts" },
    format: "cjs",
    outExtensions: () => ({ js: ".js" }),
    target: "node20",
    clean: false,
    platform: "node",
    minify: true,
    treeshake: false,
    sourcemap: false,
    deps: sharedDeps,
    alias: sharedAlias,
  },
]);
