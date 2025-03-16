import { workspace } from "vscode";
import { existsSync } from "fs";
import { dirname, join } from "path";

export const findProjectRoot = (startPath: string): string => {
  let currentDir = startPath;

  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, "package.json"))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return workspace.workspaceFolders?.[0]?.uri.fsPath || "";
};
