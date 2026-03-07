import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { extractContent, type PackageName } from "@intlayer/babel";
import {
  getConfiguration,
  type GetConfigurationOptions,
} from "@intlayer/config/node";
import { getUnmergedDictionaries } from "@intlayer/unmerged-dictionaries-entry";
import { Uri, window, workspace, RelativePattern } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";

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

  const { baseDir, codeDir, excludedPath } = configuration.content;
  const { traversePattern } = configuration.build;
  const dependencies = getDependencies(baseDir);

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
    // 1. Safely handle arrays (fallback to defaults if undefined)
    const traverseArr = Array.isArray(traversePattern) ? traversePattern : [];
    const excludeArr = Array.isArray(excludedPath) ? excludedPath : [];
    const codeDirArr = Array.isArray(codeDir) ? codeDir : ["."];

    // 2. Separate positive and negative patterns
    const positivePatterns = traverseArr.filter(
      (p) => typeof p === "string" && !p.startsWith("!"),
    );
    const negativePatterns = traverseArr
      .filter((p) => typeof p === "string" && p.startsWith("!"))
      .map((p) => p.slice(1));

    if (positivePatterns.length === 0) {
      positivePatterns.push("**/*.{tsx,jsx,vue,svelte,ts,js}");
    }

    // 3. Format the include and exclude strings for VS Code GlobPattern
    const includeGlob =
      positivePatterns.length === 1
        ? positivePatterns[0]
        : `{${positivePatterns.join(",")}}`;

    const combinedExcludes = [...excludeArr, ...negativePatterns].filter(
      Boolean,
    );
    const excludeGlob =
      combinedExcludes.length === 0
        ? null
        : combinedExcludes.length === 1
          ? combinedExcludes[0]
          : `{${combinedExcludes.join(",")}}`;

    // Helper: check if a resolved dir path is itself excluded (e.g. codeDir points into a dist folder)
    const isDirExcluded = (dirPath: string): boolean =>
      combinedExcludes.some((pattern) => {
        // Extract literal path segments from the glob (ignore wildcard segments)
        const segments = pattern
          .split("/")
          .filter((s) => !s.includes("*") && s.length > 0);
        const parts = dirPath.split("/");
        return segments.some((seg) => parts.includes(seg));
      });

    // 4. Fetch files for every directory mapping correctly to Uri to avoid "Illegal base/pattern"
    const urisArrays = await Promise.all(
      codeDirArr
        .filter((dir) => !isDirExcluded(resolve(baseDir, String(dir))))
        .map((dir) => {
        // Guarantee an absolute path and convert to URI for strict VS Code compliance
        const absoluteDir = resolve(baseDir, String(dir));
        const baseUri = Uri.file(absoluteDir);

        const searchPattern = new RelativePattern(baseUri, includeGlob);
        const excludePattern = excludeGlob
          ? new RelativePattern(baseUri, excludeGlob)
          : null;

        return workspace.findFiles(searchPattern, excludePattern);
      }),
    );

    // Flatten and deduplicate files based on their absolute paths
    const allUris = urisArrays.flat();
    const uniqueUris = Array.from(
      new Map(allUris.map((uri) => [uri.fsPath, uri])).values(),
    );

    const activeFilePath = window.activeTextEditor?.document.uri.fsPath;

    const items = uniqueUris.map((uri) => {
      const relPath = relative(baseDir, uri.fsPath);
      return {
        label: relPath,
        description: uri.fsPath,
        picked: uri.fsPath === activeFilePath,
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
