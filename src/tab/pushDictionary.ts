import { window } from "vscode";
import { push } from "@intlayer/cli";
import { getConfiguration } from "@intlayer/config";
import { getBuiltDictionariesPath } from "@intlayer/chokidar";
import { readFile } from "fs/promises";
import { Dictionary } from "intlayer";
import { findProjectRoot } from "./findProjectRoot";

export const pushDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    key?: string;
    projectDir?: string;
  };

  // Push can only be made for merged dictionaries (dictionary nodes without filePath)
  if (!node || node.type !== "dictionary" || !node.projectDir || !node.key) {
    window.showWarningMessage(
      "Push is only available for merged dictionaries."
    );
    return;
  }

  const projectDir = findProjectRoot();
  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    const configuration = getConfiguration({ baseDir: projectDir });
    const builtDictionariesPath = getBuiltDictionariesPath(configuration);

    const dictionaryPath = builtDictionariesPath.find((p) =>
      p.endsWith(`${node.key}.json`)
    );

    if (!dictionaryPath) {
      window.showErrorMessage("Dictionary not found.");
      return;
    }

    const dictionaryString = await readFile(dictionaryPath, "utf8");
    const dictionary = JSON.parse(dictionaryString) as Dictionary;

    const displayName = dictionary.key;
    window.showInformationMessage(`Pushing ${displayName}…`);
    await push({
      configOptions: { baseDir: projectDir },
      dictionaries: [dictionary.key],
    });
    window.showInformationMessage(`Pushed ${displayName}`);
  } catch (error) {
    window.showErrorMessage(`Push failed: ${(error as Error).message}`);
  }
};
