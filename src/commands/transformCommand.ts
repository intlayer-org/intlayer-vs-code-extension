import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type GetConfigurationOptions } from "@intlayer/config";
import { transformFiles, type PackageName } from "@intlayer/chokidar";
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

export const transformCommand = async (resource?: Uri) => {
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

  const configOptions: GetConfigurationOptions = await getConfigurationOptions(
    projectDir
  );

  // Detect package
  const dependencies = getDependencies(projectDir);
  let packageName: PackageName = "react-intlayer";

  if (dependencies["next-intlayer"]) {
    packageName = "next-intlayer";
  } else if (dependencies["vue-intlayer"]) {
    packageName = "vue-intlayer";
  } else if (dependencies["svelte-intlayer"]) {
    packageName = "svelte-intlayer";
  } else if (dependencies["react-intlayer"]) {
    packageName = "react-intlayer";
  } else if (dependencies["preact-intlayer"]) {
    packageName = "preact-intlayer";
  } else if (dependencies["solid-intlayer"]) {
    packageName = "solid-intlayer";
  } else if (dependencies["angular-intlayer"]) {
    packageName = "angular-intlayer";
  } else if (dependencies["express-intlayer"]) {
    packageName = "express-intlayer";
  }

  let filesToTransform: string[] = [];

  if (resource) {
    filesToTransform = [resource.fsPath];
  } else {
    // Find files logic
    const globPattern = "**/*.{tsx,jsx,vue,svelte,ts,js}";
    const excludePattern =
      "**/{*.content.{ts,tsx,js,jsx,mjs,cjs},*.config.{ts,tsx,js,jsx,mjs,cjs},*.test.{ts,tsx,js,jsx,mjs,cjs},*.stories.{ts,tsx,js,jsx,mjs,cjs},node_modules/**,dist/**,build/**}";

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
        "No transformable files found in the project."
      );
      return;
    }

    const selected = await window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select files to transform",
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
    (doc) => filesToTransform.includes(doc.uri.fsPath) && doc.isDirty
  );
  if (dirtyDocs.length > 0) {
    await Promise.all(dirtyDocs.map((doc) => doc.save()));
  }

  try {
    await transformFiles(filesToTransform, packageName, {
      configOptions,
    });
    window.showInformationMessage(
      `Successfully transformed ${filesToTransform.length} files.`
    );
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    window.showErrorMessage(`Error transforming files: ${message}`);
  }
};
