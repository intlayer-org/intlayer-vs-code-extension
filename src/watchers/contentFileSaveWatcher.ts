import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDictionary,
  createTypes,
  loadLocalDictionaries,
} from "@intlayer/chokidar/build";
import { getConfiguration } from "@intlayer/config/node";
import { type Disposable, window, workspace } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";
import { FILE_EXTENSIONS } from "@intlayer/config/defaultValues";

const REBUILD_DELAY_MS = 5_000;

/**
 * Watches content declaration file saves and rebuilds the dictionary if the
 * watcher (chokidar / app dev server) did not already do it within 5 seconds.
 *
 * This keeps dictionaries up to date when the watcher is not running.
 */
export const contentFileSaveWatcher = (): Disposable => {
  const pendingTimers = new Map<string, NodeJS.Timeout>();

  const subscription = workspace.onDidSaveTextDocument(async (document) => {
    const filePath = document.uri.fsPath;
    const projectDir = findProjectRoot(filePath);
    if (!projectDir) return;

    const configOptions = await getConfigurationOptions(projectDir, false);
    const config = getConfiguration(configOptions);

    const fileExtensions = config.content?.fileExtensions ?? FILE_EXTENSIONS;

    if (!fileExtensions.some((ext) => filePath.endsWith(ext))) return;

    const saveTime = Date.now();

    const existing = pendingTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingTimers.delete(filePath);

      try {
        const localeDictionaries = await loadLocalDictionaries(
          filePath,
          config,
        );
        if (!localeDictionaries.length) return;

        // Check whether any output dictionary file was not updated since the save.
        // If the chokidar watcher or dev server already handled the save, the JSON
        // mtime will be >= saveTime and we skip the rebuild.
        let needsRebuild = false;
        for (const dict of localeDictionaries) {
          const dictPath = join(
            config.system.dictionariesDir,
            `${dict.key}.json`,
          );
          if (!existsSync(dictPath)) {
            needsRebuild = true;
            break;
          }
          const { mtimeMs } = await stat(dictPath);
          if (mtimeMs < saveTime) {
            needsRebuild = true;
            break;
          }
        }

        if (!needsRebuild) return;

        const dictionariesOutput = await buildDictionary(
          localeDictionaries,
          config,
        );
        const updatedDictionaries = Object.values(
          dictionariesOutput?.mergedDictionaries ?? {},
        ).map((d) => d.dictionary);

        await createTypes(updatedDictionaries, config);

        await window.showInformationMessage(
          `${prefix}Dictionary rebuilt (watcher was not running).`,
        );
      } catch (error) {
        await window.showErrorMessage(
          `${prefix}Auto-rebuild failed: ${(error as Error).message}`,
        );
      }
    }, REBUILD_DELAY_MS);

    pendingTimers.set(filePath, timer);
  });

  return {
    dispose: () => {
      subscription.dispose();
      for (const timer of pendingTimers.values()) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
    },
  };
};
