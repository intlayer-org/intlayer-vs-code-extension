import { dirname, join } from "node:path";
import {
  type DefinitionLink,
  type DefinitionProvider,
  Position,
  Range,
  Uri,
  window,
} from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getCachedConfig, getCachedDictionary } from "./utils/intlayerCache";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition: async (document, position) => {
    // 1. Fast Regex Check
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
    const originSelectionRange = new Range(
      range.start.translate(0, 1),
      range.end.translate(0, -1)
    );

    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);

    if (!projectDir) {
      window.showErrorMessage("Could not find intlayer project root.");
      return;
    }

    // 2. Get Config (OPTIMIZED: Uses Cache)
    const config = await getCachedConfig(projectDir);

    const dictionaryPath = join(
      config.content.unmergedDictionariesDir,
      `${word}.json`
    );

    // 3. Get Dictionary (OPTIMIZED: Shared Cache)
    const dictionaries = await getCachedDictionary(dictionaryPath);

    if (!dictionaries) {
      return null;
    }

    const links: DefinitionLink[] = dictionaries
      .filter((dictionary) => Boolean(dictionary.filePath))
      .map((dictionary) => {
        if (!dictionary.filePath) {
          return undefined;
        }
        return {
          originSelectionRange,
          targetUri: Uri.file(join(projectDir, dictionary.filePath!)), // Non-null assertion safe due to filter
          targetRange: new Range(new Position(0, 0), new Position(0, 0)),
        } as DefinitionLink;
      })
      .filter((link): link is DefinitionLink => !!link);

    return links.length ? links : null;
  },
};
