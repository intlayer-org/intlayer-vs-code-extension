import { basename } from "node:path";
import {
  buildDictionary,
  createTypes,
  loadLocalDictionaries,
} from "@intlayer/chokidar";
import { getConfiguration } from "@intlayer/config";
import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const buildDictionaryList = async (filePaths?: string[]) => {
  if (!filePaths) {
    filePaths = [];
  }

  for (const filePath of filePaths) {
    const projectDir = findProjectRoot(filePath[0]);

    if (!projectDir) {
      window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
      return;
    }

    const configOptions = await getConfigurationOptions(projectDir);
    const config = getConfiguration(configOptions);

    try {
      const localeDictionaries = await loadLocalDictionaries(filePath, config);
      const dictionariesOutput = await buildDictionary(
        localeDictionaries,
        config
      );

      const updatedDictionariesPaths = Object.values(
        dictionariesOutput?.mergedDictionaries ?? {}
      ).map((dictionary) => dictionary.dictionaryPath);

      await createTypes(updatedDictionariesPaths, config);

      const fileName = basename(filePath);
      window.showInformationMessage(
        `${prefix}Build completed successfully for ${fileName}`
      );
    } catch (error) {
      window.showErrorMessage(
        `${prefix} single-dictionary build failed: ${(error as Error).message}`
      );
    }
  }
};
