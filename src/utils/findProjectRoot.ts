import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { window, workspace } from "vscode";

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

/**
 * Discover all Intlayer project roots inside the current workspace folder.
 * An Intlayer project root is a directory containing a package.json that
 * has an `intlayer` dependency (regular/dev/peer).
 *
 * This function performs a synchronous directory walk with basic ignores to
 * keep it reasonably fast in typical monorepos.
 */
export const findAllProjectRoots = (startPath?: string): string[] => {
  const workspaceRoot =
    startPath || workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return [];
  }

  const ignoreDirNames = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    "target",
    "vendor",
  ]);

  const queue: string[] = [workspaceRoot];
  const visited = new Set<string>();
  const roots: string[] = [];

  while (queue.length > 0) {
    const dir = queue.pop() as string;
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);

    try {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          const hasIntlayer = Boolean(pkg?.dependencies?.intlayer);
          if (hasIntlayer) {
            roots.push(dir);
          }
        } catch {
          // ignore invalid package.json
        }
      }

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (ignoreDirNames.has(entry.name)) {
          continue;
        }
        const child = join(dir, entry.name);
        // Avoid following symlinks or special files
        try {
          const st = statSync(child);
          if (!st.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }
        queue.push(child);
      }
    } catch {
      // best effort
    }
  }

  return roots;
};
