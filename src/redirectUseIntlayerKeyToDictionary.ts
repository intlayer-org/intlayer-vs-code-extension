import { getConfiguration } from "@intlayer/config";
import { type Dictionary } from "@intlayer/core";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import {
  DefinitionLink,
  DefinitionProvider,
  Location,
  Position,
  Range,
  Uri,
  window,
} from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition(document, position) {
    const range = document.getWordRangeAtPosition(position, /["'][^"']+["']/);
    if (!range) {
      return null;
    }

    const word = document.getText(range).replace(/["']/g, "");
    const originSelectionRange = new Range(
      range.start.translate(0, 1),
      range.end.translate(0, -1)
    );

    const lineText = document.lineAt(position.line).text;
    if (
      !(lineText.includes("useIntlayer") || lineText.includes("getIntlayer"))
    ) {
      return null;
    }

    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);

    if (!projectDir) {
      window.showErrorMessage("Could not find intlayer project root.");
      return;
    }

    const config = getConfiguration({ baseDir: projectDir });

    const dictionaryPath = join(
      config.content.unmergedDictionariesDir,
      `${word}.json`
    );

    if (!existsSync(dictionaryPath)) {
      console.warn("Dictionary not found", { dictionaryPath });
      return null;
    }

    const dictionaryFileContent = readFileSync(dictionaryPath, "utf8");

    const dictionaryies = JSON.parse(dictionaryFileContent) as Dictionary[];

    const links: DefinitionLink[] = dictionaryies
      .filter((dictionary) => Boolean(dictionary.filePath))
      .map((dictionary) => {
        if (!dictionary.filePath) {
          return undefined;
        }
        return {
          originSelectionRange,
          targetUri: Uri.file(join(projectDir, dictionary.filePath)),
          targetRange: new Range(new Position(0, 0), new Position(0, 0)),
        } as DefinitionLink;
      })
      .filter((link) => typeof link !== "undefined") as DefinitionLink[];

    return links.length ? links : null;
  },
};
