import { window } from "vscode";
import { pull } from "@intlayer/cli";
import { findProjectRoot } from "./findProjectRoot";

export const pullDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    key?: string;
    projectDir?: string;
  };

  // Pull can only be made for merged dictionaries (dictionary nodes without filePath)
  if (!node || node.type !== "dictionary" || !node.projectDir || !node.key) {
    window.showWarningMessage(
      "Pull is only available for merged dictionaries."
    );
    return;
  }

  const projectDir = findProjectRoot();
  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    const displayName = node.key;
    window.showInformationMessage(`Pulling ${displayName}…`);
    await pull({
      configOptions: { baseDir: projectDir },
      dictionaries: [node.key],
    });
    window.showInformationMessage(`Pulled ${displayName}`);
  } catch (error) {
    window.showErrorMessage(`Pull failed: ${(error as Error).message}`);
  }
};
