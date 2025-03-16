import { Position, Uri, Location, DefinitionProvider } from "vscode";
import { getConfiguration } from "@intlayer/config";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import { findProjectRoot } from "./findProjectRoot";

export const redirectUseIntlayerKeyToDictionary: DefinitionProvider = {
  provideDefinition(document, position) {
    const range = document.getWordRangeAtPosition(position, /'[^']+'|"[^"]+"/);
    if (!range) {
      return null;
    }

    const word = document.getText(range).replace(/['"]/g, "");
    const lineText = document.lineAt(position.line).text;
    if (!lineText.includes("useIntlayer")) {
      return null;
    }

    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);
    const config = getConfiguration({ baseDir: projectDir });

    const dictionaryEntryPath = join(
      projectDir,
      config.content.dictionariesDir,
      `${word}.json`
    );

    if (!existsSync(dictionaryEntryPath)) {
      return null;
    }

    const dictionaryFileContent = readFileSync(dictionaryEntryPath, "utf8");
    const dictionary = JSON.parse(dictionaryFileContent);
    if (!dictionary || typeof dictionary.filePath !== "string") {
      return null;
    }

    return new Location(Uri.file(dictionary.filePath), new Position(0, 0));
  },
};
