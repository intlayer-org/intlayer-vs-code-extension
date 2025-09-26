import { window } from "vscode";
import { getConfiguration } from "@intlayer/config";
import { buildDictionary, loadLocalDictionaries } from "@intlayer/chokidar";
import { createTypes } from "@intlayer/chokidar";
import { findProjectRoot } from "../utils/findProjectRoot";
import { createRequire } from "module";
import { basename, join } from "path";
import { prefix } from "../utils/logFunctions";
import { getConfigurationOptions } from "../utils/getConfiguration";

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

    const projectRequire = createRequire(join(projectDir, "package.json"));
    const configOptions = await getConfigurationOptions(projectDir);
    const config = getConfiguration(configOptions);

    try {
      const localeDictionaries = await loadLocalDictionaries(
        filePath,
        config,
        projectRequire
      );
      const dictionariesOutput = await buildDictionary(
        localeDictionaries,
        config
      );

      const updatedDictionariesPaths = Object.values(
        dictionariesOutput?.mergedDictionaries ?? {}
      ).map((dictionary: any) => dictionary.dictionaryPath);

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
