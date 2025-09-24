import { window } from "vscode";
import { getConfiguration } from "@intlayer/config";
import { buildDictionary, loadLocalDictionaries } from "@intlayer/chokidar";
import { createTypes } from "@intlayer/chokidar";
import { findProjectRoot } from "../tab/findProjectRoot";
import { createRequire } from "module";
import path from "path";

export const buildActiveDictionary = async () => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage(
      "No active editor. Open a content declaration file."
    );
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const projectDir = findProjectRoot(filePath);

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  const projectRequire = createRequire(path.join(projectDir, "package.json"));

  const config = getConfiguration({ baseDir: projectDir });

  try {
    window.showInformationMessage("Building current Intlayer dictionary...");

    const localeDictionaries = await loadLocalDictionaries(
      filePath,
      config,
      projectRequire
    );
    const dictionariesOutput = await buildDictionary(
      localeDictionaries,
      config
    );

    const updatedDictionariesPaths = Object.values(
      dictionariesOutput?.mergedDictionaries ?? {}
    ).map((dictionary: any) => dictionary.dictionaryPath);

    await createTypes(updatedDictionariesPaths, config);

    window.showInformationMessage(
      "Intlayer: Current dictionary built successfully!"
    );
  } catch (error) {
    console.error(error);
    window.showErrorMessage(
      `Intlayer single-dictionary build failed: ${(error as Error).message}`
    );
  }
};
