import { window } from "vscode";
import { pull } from "@intlayer/cli";
import { getIntlayerAPIProxy } from "@intlayer/api";
import { findProjectRoot } from "../tab/findProjectRoot";
import { getConfiguration } from "@intlayer/config";
import { Dictionary } from "intlayer";

export const pullCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  window.showInformationMessage("Fetching dictionaries...");

  try {
    const configuration = getConfiguration({
      baseDir: projectDir,
    });
    const apiProxy = getIntlayerAPIProxy(undefined, configuration);
    const dictionariesKeysResult =
      await apiProxy.dictionary.getDictionariesKeys();
    const dictionaries = dictionariesKeysResult.data as Dictionary[];

    if (!dictionaries.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    // Try to preselect based on the active editor file name matching a dictionary key
    const activeEditor = window.activeTextEditor;
    const activeFileName = activeEditor
      ? activeEditor.document.uri.fsPath
      : undefined;

    const quickPickItems = dictionaries.map((dict) => ({
      label: dict.key,
      picked:
        !!activeFileName &&
        (activeFileName.endsWith(`${dict.key}.content.ts`) ||
          activeFileName.endsWith(`${dict.key}.content.js`) ||
          activeFileName.endsWith(`${dict.key}.content.json`)),
    }));

    // Place the preselected item(s) at the top of the list
    quickPickItems.sort((a, b) =>
      a.picked === b.picked ? 0 : a.picked ? -1 : 1
    );

    const selectedDictionaries = await window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder: "Select dictionaries to pull",
    });

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage("No dictionary selected.");
      return;
    }

    window.showInformationMessage("Pulling...");

    await pull({
      configOptions: {
        baseDir: projectDir,
      },
      dictionaries: selectedDictionaries.map((d) => d.label),
    });

    window.showInformationMessage("Intlayer pull completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer pull failed: ${(error as Error).message}`
    );
  }
};
