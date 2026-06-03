import { dirname, extname, join } from "node:path";
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
import { extractScriptContent } from "./utils/extractScript";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition: async (document, position) => {
    // For Vue / Svelte / Astro files, pass only the script block content to the
    // AST parser. The raw SFC text contains template HTML that confuses oxc
    // (e.g. Vue's <script setup> attributes, Svelte control-flow tags).
    // extractScriptContent replaces non-script content with spaces so byte
    // offsets remain valid and findKeyAtOffset still works correctly.
    const text = document.getText();
    const extension = extname(document.uri.fsPath).toLowerCase();
    const scriptContent = extractScriptContent(text, extension);
    const offset = document.offsetAt(position);
    const word = findKeyAtOffset(scriptContent, offset);

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
