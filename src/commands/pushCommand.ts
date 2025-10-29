import { loadContentDeclarations } from "@intlayer/chokidar";
import { push } from "@intlayer/cli"; // Assume getDictionaries fetches available dictionaries
import { getConfiguration } from "@intlayer/config";
import type { Dictionary } from "@intlayer/types";
import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";
import { selectLocalDictionaries } from "../utils/selectContentDeclaration";

export const pushCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const selectedDictionaries = await selectLocalDictionaries(projectDir);

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage(`${prefix}No dictionary selected.`);
      return;
    }

    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);

    const localDictionaries: Dictionary[] = await loadContentDeclarations(
      selectedDictionaries,
      configuration
    );

    window.showInformationMessage(JSON.stringify(localDictionaries));
    const dictionariesKeys = localDictionaries.map(
      (dictionary) => dictionary.key
    );

    window.showInformationMessage(`${prefix}Pushing dictionaries...`);

    await push({
      configOptions,
      dictionaries: dictionariesKeys,
    });

    window.showInformationMessage(`${prefix} push completed successfully!`);
  } catch (error) {
    window.showErrorMessage(
      `${prefix} push failed: ${(error as Error).message}`
    );
  }
};
