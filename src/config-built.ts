import { createRequire } from "node:module";
import { join } from "node:path";
import { getAlias, getConfiguration } from "@intlayer/config";
import { window } from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getConfigurationOptionsSync } from "./utils/getConfiguration";
import { prefix } from "./utils/logFunctions";

// Cache the result globally
let cachedConfig: any = null;
let lastProjectDir: string | null = null;

const loadConfig = () => {
  const editor = window.activeTextEditor;
  if (!editor) {
    return {};
  }

  const filePath = editor.document.uri.fsPath;

  // Optimization: Do not look for project root if we are in the same workspace folder as last time
  // (You might want to refine this based on workspace.workspaceFolders)

  const projectDir = findProjectRoot(filePath);
  if (!projectDir) {
    return {};
  }

  // 2. Return cached config if project hasn't changed
  // (Optional: add a Time-To-Live check here if config changes often, e.g., 5 seconds)
  if (cachedConfig && lastProjectDir === projectDir) {
    return cachedConfig;
  }

  try {
    const configOptions = getConfigurationOptionsSync(projectDir);
    const configuration = getConfiguration(configOptions);

    const configDirPath = getAlias({
      configuration,
      format: "cjs",
      formatter: (path) => join(projectDir, path),
    });

    const projectRequire = createRequire(join(projectDir, "package.json"));
    const result = projectRequire(configDirPath["@intlayer/config/built"]);

    cachedConfig = result;
    lastProjectDir = projectDir;

    return result;
  } catch (error) {
    console.error(`${prefix} Error loading configuration:`, error);
    return {};
  }
};

// If you must keep the proxy for API compatibility, ensure loadConfig is extremely fast (via the cache above).
const configJSON = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // This access is now fast because loadConfig returns a cached object
      const config = loadConfig();
      return config?.[prop];
    },
  },
);

export default configJSON;
