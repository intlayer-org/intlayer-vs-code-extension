import { readFile } from "node:fs/promises";
import { getBuiltDictionariesPath } from "@intlayer/chokidar";
import { push } from "@intlayer/cli";
import { getConfiguration } from "@intlayer/config";
import type { Dictionary } from "@intlayer/types";
import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const pushDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    key?: string;
    projectDir?: string;
  };

  // Push can only be made for merged dictionaries (dictionary nodes without filePath)
  if (!node || node.type !== "dictionary" || !node.projectDir || !node.key) {
    window.showWarningMessage(
      `${prefix}Push is only available for merged dictionaries.`
    );
    return;
  }

  const projectDir = findProjectRoot();
  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);
    const builtDictionariesPath = await getBuiltDictionariesPath(configuration);

    const dictionaryPath = builtDictionariesPath.find((p) =>
      p.endsWith(`${node.key}.json`)
    );

    if (!dictionaryPath) {
      window.showErrorMessage(`${prefix}Dictionary not found.`);
      return;
    }

    const dictionaryString = await readFile(dictionaryPath, "utf8");
    const dictionary = JSON.parse(dictionaryString) as Dictionary;

    const displayName = dictionary.key;

    window.showInformationMessage(`${prefix}Pushing ${displayName}…`);
    await push({
      configOptions,
      dictionaries: [dictionary.key],
    });
    window.showInformationMessage(`${prefix}Pushed ${displayName}`);
  } catch (error) {
    window.showErrorMessage(
      `${prefix}Push failed: ${(error as Error).message}`
    );
  }
};
