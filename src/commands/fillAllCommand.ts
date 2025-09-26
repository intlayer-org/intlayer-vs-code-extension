import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { listDictionaries } from "@intlayer/chokidar";
import { findProjectRoot } from "../utils/findProjectRoot";
import { relative } from "path";
import { getConfiguration } from "@intlayer/config";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const fillCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);
    const dictionaries = listDictionaries(configuration);

    if (!dictionaries.length) {
      window.showWarningMessage(`${prefix}No dictionaries available.`);
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
      window.showWarningMessage(`${prefix}No dictionary selected.`);
      return;
    }

    for (const { label: dictionary } of selectedDictionaries) {
      window.showInformationMessage(`${prefix}Filling ${dictionary}…`);
      // await each fill before moving on

      await fill({
        configOptions,
        keys: dictionary,
      });
    }

    window.showInformationMessage(`${prefix} fill completed successfully!`);
  } catch (error) {
    window.showErrorMessage(
      `${prefix} fill failed: ${(error as Error).message}`
    );
  }
};
