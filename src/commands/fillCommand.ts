import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { listDictionaries } from "@intlayer/chokidar";
import { findProjectRoot } from "../tab/findProjectRoot";
import { relative } from "path";
import { getConfiguration } from "@intlayer/config";

export const fillCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    const configuration = getConfiguration({
      baseDir: projectDir,
    });
    const dictionaries = listDictionaries(configuration);

    if (!dictionaries.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    // Compute active file relative path to preselect if it is a content file
    const activeEditor = window.activeTextEditor;
    const activeRelativePath = activeEditor
      ? relative(projectDir, activeEditor.document.uri.fsPath)
      : undefined;

    // Show a selection dialog with multiple choices
    const quickPickItems = dictionaries
      .map((path) => relative(projectDir, path))
      .map((dict) => ({ label: dict, picked: dict === activeRelativePath }));

    // Place the preselected item(s) at the top of the list
    quickPickItems.sort((a, b) =>
      a.picked === b.picked ? 0 : a.picked ? -1 : 1
    );

    const selectedDictionaries = await window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder: "Select dictionaries to fill",
    });

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage("No dictionary selected.");
      return;
    }

    window.showInformationMessage("filling...");

    for (const { label: dictionary } of selectedDictionaries) {
      window.showInformationMessage(`Filling ${dictionary}…`);
      // await each fill before moving on
      try {
        const result = await fill({
          configOptions: { baseDir: projectDir },
          keys: dictionary,
        });
        window.showInformationMessage(`Result for ${dictionary}: ${result}`);
      } catch (error) {
        window.showErrorMessage(
          `Intlayer fill failed: ${(error as Error).message}`
        );
      }
    }

    window.showInformationMessage("Intlayer fill completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer fill failed: ${(error as Error).message}`
    );
  }
};
