import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";
import { dirname } from "path";

export const fillDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    filePath?: string;
    projectDir?: string;
  };

  // Fill can only be made for unmerged dictionaries (file nodes with filePath)
  if (!node || node.type !== "file" || !node.projectDir || !node.filePath) {
    window.showWarningMessage(
      `${prefix}Fill is only available for unmerged dictionary files.`
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

    window.showInformationMessage(`${prefix}Filling ${dirname(node.filePath)}…`);
    await fill({
      configOptions,
      file: node.filePath,
    });
    window.showInformationMessage(`${prefix}Filled ${node.filePath}`);
  } catch (error) {
    window.showErrorMessage(
      `${prefix}Fill failed: ${(error as Error).message}`
    );
  }
};
