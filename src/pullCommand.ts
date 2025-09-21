import { window } from "vscode";
import { pull } from "@intlayer/cli";
import { getIntlayerAPIProxy } from "@intlayer/api";
import { findProjectRoot } from "./findProjectRoot";
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

    // Show a selection dialog with multiple choices
    const selectedDictionaries = await window.showQuickPick(
      dictionaries.map((dict) => ({ label: dict.key, picked: false })), // Display dictionary names
      {
        canPickMany: true,
        placeHolder: "Select dictionaries to pull",
      }
    );

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
