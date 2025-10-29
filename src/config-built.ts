import { join } from "node:path";
import { createRequire } from "node:module";
import { getAlias, getConfiguration } from "@intlayer/config";
import { window } from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { prefix } from "./utils/logFunctions";
import { getConfigurationOptionsSync } from "./utils/getConfiguration";

const editor = window.activeTextEditor;
if (!editor) {
  window.showErrorMessage(
    `${prefix}No active editor. Open a content declaration file.`
  );
  throw new Error("No active editor");
}

const filePath = editor.document.uri.fsPath;

const projectDir = findProjectRoot(filePath);

if (!projectDir) {
  window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
  throw new Error("Could not find intlayer project root");
}

const configOptions = getConfigurationOptionsSync(projectDir);

// This config do not resolve the env vars, so we need to build it once without first to extract the location of the @intlayer/config/built alias
// And then we return the JSON object
const configuration = getConfiguration(configOptions);

const configDirPath = getAlias({
  configuration,
  format: "cjs",
  formatter: (path) => join(projectDir, path),
});

const projectRequire = createRequire(join(projectDir, "package.json"));

const configJSON = projectRequire(configDirPath["@intlayer/config/built"]);

export default configJSON;
