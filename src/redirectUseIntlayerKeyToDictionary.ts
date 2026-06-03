import { dirname, join } from "node:path";
import { findKeyAtOffset } from "@intlayer/lsp/utils";
import {
  type DefinitionLink,
  type DefinitionProvider,
  Position,
  Range,
  Uri,
} from "vscode";
import { findFieldLocation } from "./utils/findFieldLocation";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getCachedConfig, getCachedDictionary } from "./utils/intlayerCache";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition: async (document, position) => {
    // Use the Oxc-based AST parser to find the Intlayer dictionary key at the
    // cursor position. This correctly handles multi-line calls, TypeScript
    // generics, comments, and template literals without regex edge cases.
    const text = document.getText();
    const offset = document.offsetAt(position);
    const word = findKeyAtOffset(text, offset);

    if (!word) {
      return null;
    }

    // Compute the origin selection range (the key string without its quotes)
    // so VS Code highlights just the key text in the editor.
    const wordRange = document.getWordRangeAtPosition(position, /["'`][^"'`]+["'`]/);
    const originSelectionRange = wordRange
      ? new Range(
          wordRange.start.translate(0, 1),
          wordRange.end.translate(0, -1),
        )
      : new Range(position, position);

    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);

    if (!projectDir) {
      return null;
    }

    // Load configuration (cached)
    const config = await getCachedConfig(projectDir);

    const dictionaryPath = join(
      config.system.unmergedDictionariesDir,
      `${word}.json`,
    );

    // Load the unmerged dictionary (cached)
    const dictionaries = await getCachedDictionary(dictionaryPath);

    if (!dictionaries) {
      return null;
    }

    const links: DefinitionLink[] = [];

    for (const dictionary of dictionaries) {
      if (!dictionary.filePath) {
        continue;
      }

      const absoluteSourcePath = join(projectDir, dictionary.filePath);
      const sourceUri = Uri.file(absoluteSourcePath);

      // Jump directly to the `content` field in the source file if possible.
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
        targetRange,
        targetSelectionRange: targetRange,
      });
    }

    return links.length ? links : null;
  },
};
