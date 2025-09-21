import { window, workspace } from "vscode";
import { existsSync, readFileSync } from "fs";
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
    if (existsSync(join(currentDir, "package.json"))) {
      const packageJson = JSON.parse(
        readFileSync(join(currentDir, "package.json"), "utf8")
      );

      if (
        packageJson?.dependencies?.intlayer ||
        packageJson?.devDependencies?.intlayer ||
        packageJson?.peerDependencies?.intlayer
      ) {
        return currentDir;
      }

      // Check if .intlayer file exists in the same directory
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return repoDir;
};
