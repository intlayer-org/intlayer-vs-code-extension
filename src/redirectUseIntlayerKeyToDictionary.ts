import { dirname, join } from "node:path";
import {
  type DefinitionLink,
  type DefinitionProvider,
  Position,
  Range,
  Uri,
} from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getCachedConfig, getCachedDictionary } from "./utils/intlayerCache";
import { findFieldLocation } from "./utils/findFieldLocation";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition: async (document, position) => {
    // 1. Fast Regex Check (Safe: Does not trigger recursive Definition lookups)
    const range = document.getWordRangeAtPosition(position, /["'][^"']+["']/);
    if (!range) {
      return null;
    }

    const lineText = document.lineAt(position.line).text;
    if (
      !(lineText.includes("useIntlayer") || lineText.includes("getIntlayer"))
    ) {
      return null;
    }

    const word = document.getText(range).replace(/["']/g, "");

    // Calculate the selection range for the visual highlight
    const originSelectionRange = new Range(
      range.start.translate(0, 1),
      range.end.translate(0, -1),
    );

    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);

    if (!projectDir) {
      return null;
    }

    // 2. Get Config (Cached)
    const config = await getCachedConfig(projectDir);

    const dictionaryPath = join(
      config.system.unmergedDictionariesDir,
      `${word}.json`,
    );

    // 3. Get Dictionary (Cached)
    const dictionaries = await getCachedDictionary(dictionaryPath);

    if (!dictionaries) {
      return null;
    }

    const links: DefinitionLink[] = [];

    // 4. Map dictionaries to specific file locations
    for (const dictionary of dictionaries) {
      if (!dictionary.filePath) {
        continue;
      }

      const absoluteSourcePath = join(projectDir, dictionary.filePath);
      const sourceUri = Uri.file(absoluteSourcePath);

      // Attempt to find the specific 'content' field in the source file
      // to jump directly to the data, rather than just the top of the file.
      const location = await findFieldLocation(absoluteSourcePath, ["content"]);

      const targetRange = location
        ? new Range(
            new Position(location.line, location.character),
            new Position(location.line, location.character),
          )
        : new Range(new Position(0, 0), new Position(0, 0));

      links.push({
        originSelectionRange,
        targetUri: sourceUri,
        targetRange: targetRange,
        targetSelectionRange: targetRange,
      });
    }

    return links.length ? links : null;
  },
};
