import { getConfiguration } from "@intlayer/config";
import { type Dictionary } from "@intlayer/core";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { DefinitionProvider, Location, Position, Uri, window } from "vscode";
import { findProjectRoot } from "./findProjectRoot";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition(document, position) {
    const range = document.getWordRangeAtPosition(position, /["'][^"']+["']/);
    if (!range) {
      return null;
    }

    const word = document.getText(range).replace(/['"]/g, "");

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

    const locations: Location[] = dictionaryies
      .map(
        (dictionary) =>
          dictionary.filePath &&
          new Location(Uri.file(dictionary.filePath), new Position(0, 0))
      )
      .filter((location) => typeof location !== "undefined") as Location[];

    return locations;
  },
};
