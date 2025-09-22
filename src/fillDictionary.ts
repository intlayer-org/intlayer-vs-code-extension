import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { findProjectRoot } from "./findProjectRoot";

export const fillDictionary = async (element?: unknown) => {
  const node = element as {
    type?: string;
    filePath?: string;
    projectDir?: string;
  };

  // Fill can only be made for unmerged dictionaries (file nodes with filePath)
  if (!node || node.type !== "file" || !node.projectDir || !node.filePath) {
    window.showWarningMessage(
      "Fill is only available for unmerged dictionary files."
    );
    return;
  }

  const projectDir = findProjectRoot();
  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    window.showInformationMessage(`Filling ${node.filePath}…`);
    await fill({
      configOptions: { baseDir: projectDir },
      file: node.filePath,
    });
    window.showInformationMessage(`Filled ${node.filePath}`);
  } catch (error) {
    window.showErrorMessage(`Fill failed: ${(error as Error).message}`);
  }
};
