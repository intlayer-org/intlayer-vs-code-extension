import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";
import { basename } from "path";

export const fillActiveDictionary = async () => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage(
      `${prefix}No active editor. Open a content declaration file.`
    );
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const projectDir = findProjectRoot(filePath);

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  const configOptions = await getConfigurationOptions(projectDir);

  await fill({
    configOptions,
    file: filePath,
  });

  const fileName = basename(filePath);
  window.showInformationMessage(
    `${prefix}Fill completed successfully for ${fileName}`
  );
};
