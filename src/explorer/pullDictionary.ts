import { pull } from "@intlayer/cli";
import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const pullDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    key?: string;
    projectDir?: string;
  };

  // Pull can only be made for merged dictionaries (dictionary nodes without filePath)
  if (!node || node.type !== "dictionary" || !node.projectDir || !node.key) {
    window.showWarningMessage(
      `${prefix}Pull is only available for merged dictionaries.`
    );
    return;
  }

  const projectDir = findProjectRoot();
  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const displayName = node.key;
    const configOptions = await getConfigurationOptions(projectDir);

    window.showInformationMessage(`${prefix}Pulling ${displayName}…`);
    await pull({
      configOptions,
      dictionaries: [node.key],
    });

    window.showInformationMessage(`${prefix}Pulled ${displayName}`);
  } catch (error) {
    window.showErrorMessage(
      `${prefix}Pull failed: ${(error as Error).message}`
    );
  }
};
