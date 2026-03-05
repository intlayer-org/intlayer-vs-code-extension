import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { extractContent, type PackageName } from "@intlayer/babel";
import {
  getConfiguration,
  type GetConfigurationOptions,
} from "@intlayer/config/node";
import { getUnmergedDictionaries } from "@intlayer/unmerged-dictionaries-entry";
import { type Uri, window, workspace } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";

// Helper to read package.json dependencies
const getDependencies = (baseDir: string) => {
  try {
    const packageJsonPath = resolve(baseDir, "package.json");
    if (!existsSync(packageJsonPath)) {
      return {};
    }
    const file = readFileSync(packageJsonPath, "utf8");
    const packageJSON = JSON.parse(file);
    return packageJSON.dependencies || {};
  } catch {
    return {};
  }
};

export const extractCommand = async (resource?: Uri) => {
  let projectDir = findProjectRoot(resource?.fsPath);

  if (!projectDir) {
    // fallback to workspace folder if only one
    if (workspace.workspaceFolders && workspace.workspaceFolders.length === 1) {
      projectDir = workspace.workspaceFolders[0].uri.fsPath;
    } else {
      window.showErrorMessage("Intlayer project root not found.");
      return;
    }
  }

  const configOptions: GetConfigurationOptions =
    await getConfigurationOptions(projectDir);
  const configuration = getConfiguration(configOptions);

  // Detect package
  const dependencies = getDependencies(projectDir);
  const dependencyNames = Object.keys(dependencies);

  // This handles hono-intlayer, fastify-intlayer, etc., automatically.
  const packageName = (dependencyNames.find((name) =>
    name.endsWith("-intlayer"),
  ) ?? "react-intlayer") as PackageName; // Fallback default

  let filesToTransform: string[] = [];

  if (resource) {
    filesToTransform = [resource.fsPath];
  } else {
    // Find files logic
    const globPattern = "**/*.{tsx,jsx,vue,svelte,ts,js}";
    const excludePattern =
      "{**/*.content.*,**/*.config.*,**/*.test.*,**/*.stories.*,**/node_modules/**,**/dist/**,**/build/**}";

    // Use vscode.workspace.findFiles
    const uris = await workspace.findFiles(globPattern, excludePattern);

    // Filter existing files and make paths relative
    const items = uris.map((uri) => {
      const relPath = projectDir
        ? relative(projectDir, uri.fsPath)
        : uri.fsPath;
      return {
        label: relPath,
        description: uri.fsPath,
        picked: false,
      };
    });

    if (items.length === 0) {
      window.showInformationMessage(
        "No transformable files found in the project.",
      );
      return;
    }

    const selected = await window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select files to extract",
    });

    if (!selected || selected.length === 0) {
      return;
    }

    filesToTransform = selected
      .map((item) => item.description)
      .filter((desc): desc is string => !!desc);
  }

  if (filesToTransform.length === 0) {
    return;
  }

  // Save dirty files before transformation to ensure disk content matches editor content
  const dirtyDocs = workspace.textDocuments.filter(
    (doc) => filesToTransform.includes(doc.uri.fsPath) && doc.isDirty,
  );

  if (dirtyDocs.length > 0) {
    await Promise.all(dirtyDocs.map((doc) => doc.save()));
  }

  const unmergedDictionaries = getUnmergedDictionaries(configuration);
  let errorCount = 0;

  await Promise.all(
    filesToTransform.map(async (filePath) => {
      try {
        await extractContent(filePath, packageName, {
          unmergedDictionaries,
          configuration,
        });
      } catch (error) {
        errorCount++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to extract ${filePath}: ${message}`);
      }
    }),
  );

  if (errorCount > 0) {
    window.showWarningMessage(
      `Completed with ${errorCount} errors. Check the debug console for details.`,
    );
  } else {
    window.showInformationMessage(
      `Successfully extracted content from ${filesToTransform.length} files.`,
    );
  }
};
