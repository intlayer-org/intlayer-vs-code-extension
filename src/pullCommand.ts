import { window } from "vscode";
import { pull } from "@intlayer/cli";
import { fetchDistantDictionaryKeys } from "@intlayer/chokidar";
import { dirname, relative } from "path";
import { findProjectRoot } from "./findProjectRoot";

export const pullCommand = async () => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage("No active text editor found.");
    return;
  }

  const fileDir = dirname(editor.document.uri.fsPath);
  const projectDir = findProjectRoot(fileDir);

  window.showInformationMessage("Fetching dictionaries...");

  try {
    const dictionariesKeys = await fetchDistantDictionaryKeys();

    if (!dictionariesKeys.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    // Show a selection dialog with multiple choices
    const selectedDictionaries = await window.showQuickPick(
      dictionariesKeys.map((dict) => ({ label: dict, picked: false })), // Display dictionary names
      {
        canPickMany: true,
        placeHolder: "Select dictionaries to pull",
      }
    );

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage("No dictionary selected.");
      return;
    }

    window.showInformationMessage("Pulling Intlayer project...");

    await pull({
      baseDir: projectDir,
      dictionaries: selectedDictionaries.map((d) => d.label),
    });

    window.showInformationMessage("Intlayer pull completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer pull failed: ${(error as Error).message}`
    );
  }
};
