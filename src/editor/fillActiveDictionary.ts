import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";

export const fillActiveDictionary = async () => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage(
      "No active editor. Open a content declaration file."
    );
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const projectDir = findProjectRoot(filePath);

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  const configOptions = await getConfigurationOptions(projectDir);

  await fill({
    configOptions,
    file: filePath,
  });
};
