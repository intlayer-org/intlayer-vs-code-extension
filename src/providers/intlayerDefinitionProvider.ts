import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfiguration } from "@intlayer/config";
import type { Dictionary } from "@intlayer/types";
import {
  type DefinitionLink,
  type DefinitionProvider,
  Position,
  Range,
  Uri,
} from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { findFieldLocation } from "../utils/findFieldLocation";
import { resolveIntlayerPath } from "../utils/intlayerPathResolver";

export const intlayerDefinitionProvider: DefinitionProvider = {
  provideDefinition: async (document, position) => {
    // 1. Resolve Path
    const origin = await resolveIntlayerPath(document, position);
    if (!origin) {
      return null;
    }

    const { dictionaryKey, fieldPath } = origin;

    // ---------------------------------------------------------
    // CHANGE: Strip accessor for definition lookup
    // ---------------------------------------------------------
    // The JSON dictionary does not contain 'value' or 'raw' keys.
    // We must remove them to find the correct node location.
    const cleanPath = [...fieldPath];
    const lastKey = cleanPath[cleanPath.length - 1];
    if (lastKey === "value" || lastKey === "raw") {
      cleanPath.pop();
    }
    // ---------------------------------------------------------

    // 2. Load Configuration
    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);
    if (!projectDir) {
      return null;
    }

    const config = getConfiguration(await getConfigurationOptions(projectDir));

    // 3. Load Unmerged Dictionary
    const dictionaryJsonPath = join(
      config.content.unmergedDictionariesDir,
      `${dictionaryKey}.json`
    );

    if (!existsSync(dictionaryJsonPath)) {
      return null;
    }

    let dictionaries: Dictionary[];
    try {
      dictionaries = JSON.parse(readFileSync(dictionaryJsonPath, "utf8"));
    } catch {
      return null;
    }

    // 4. Find Definition Targets
    const targets: DefinitionLink[] = [];

    for (const dict of dictionaries) {
      if (dict.location !== "local" || !dict.filePath) {
        continue;
      }

      const absoluteSourcePath = join(projectDir, dict.filePath);
      if (!existsSync(absoluteSourcePath)) {
        continue;
      }

      const sourceUri = Uri.file(absoluteSourcePath);

      // usage: content.title -> source: { key: '...', content: { title: ... } }
      const astPath = ["content", ...cleanPath];

      const location = await findFieldLocation(absoluteSourcePath, astPath);

      const targetRange = location
        ? new Range(
            new Position(location.line, location.character),
            new Position(location.line, location.character)
          )
        : new Range(new Position(0, 0), new Position(0, 0));

      targets.push({
        originSelectionRange: document.getWordRangeAtPosition(position),
        targetUri: sourceUri,
        targetRange: targetRange,
        targetSelectionRange: targetRange,
      });
    }

    return targets.length > 0 ? targets : null;
  },
};
