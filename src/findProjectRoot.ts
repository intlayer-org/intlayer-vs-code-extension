import { window, workspace } from "vscode";
import { existsSync } from "fs";
import { dirname, join } from "path";

const getActiveFilePath = () => {
  const activeFile = window.activeTextEditor?.document.uri.fsPath;
  if (!activeFile) {
    return undefined;
  }
  return activeFile;
};

export const findProjectRoot = (startPath?: string): string | undefined => {
  const repoDir = workspace.workspaceFolders?.[0]?.uri.fsPath;
  let currentDir = startPath ?? getActiveFilePath();

  while (
    currentDir &&
    currentDir !== dirname(currentDir) &&
    currentDir.length >= (repoDir?.length ?? 0)
  ) {
    if (
      existsSync(join(currentDir, "package.json")) &&
      existsSync(join(currentDir, ".intlayer"))
    ) {
      // Check if .intlayer file exists in the same directory
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return undefined;
};
