import { window } from "vscode";
import { push } from "@intlayer/cli"; // Assume getDictionaries fetches available dictionaries
import { relative } from "path";
import { findProjectRoot } from "./findProjectRoot";
import unmergedDictionariesRecord from "@intlayer/unmerged-dictionaries-entry";

export const pushCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  window.showInformationMessage("Fetching dictionaries...");

  try {
    if (!unmergedDictionariesRecord.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    // Compute active file relative path to preselect if it is a content file
    const activeEditor = window.activeTextEditor;
    const activeRelativePath = activeEditor
      ? relative(projectDir, activeEditor.document.uri.fsPath)
      : undefined;

    // Show a selection dialog with multiple choices
    const quickPickItems = Object.keys(unmergedDictionariesRecord)
      .map((path) => relative(projectDir, path))
      .map((dict) => ({ label: dict, picked: dict === activeRelativePath }));

    // Place the preselected item(s) at the top of the list
    quickPickItems.sort((a, b) =>
      a.picked === b.picked ? 0 : a.picked ? -1 : 1
    );

    const selectedDictionaries = await window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder: "Select dictionaries to push",
    });

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage("No dictionary selected.");
      return;
    }

    window.showInformationMessage("Pushing...");

    await push({
      configOptions: {
        baseDir: projectDir,
      },
      dictionaries: selectedDictionaries.map((d) => d.label),
    });

    window.showInformationMessage("Intlayer push completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer push failed: ${(error as Error).message}`
    );
  }
};
