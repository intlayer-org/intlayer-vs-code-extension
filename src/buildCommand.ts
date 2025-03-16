import { window } from "vscode";
import { build } from "@intlayer/cli";
import { findProjectRoot } from "./findProjectRoot";
import { dirname } from "path";

export const buildCommand = async () => {
  const editor = window.activeTextEditor;

  if (!editor) {
    window.showErrorMessage("No active text editor found.");
    return;
  }

  const fileDir = dirname(editor.document.uri.fsPath);

  const projectDir = findProjectRoot(fileDir);

  window.showInformationMessage("Building Intlayer dictionaries...");

  try {
    await build({
      baseDir: projectDir,
    });

    window.showInformationMessage("Intlayer build completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer build failed: ${(error as Error).message}`
    );
  }
};
