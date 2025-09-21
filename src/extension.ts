import { commands, ExtensionContext, languages } from "vscode";
import { generateDictionaryContent } from "./createDictionaryContent";
import { buildCommand } from "./buildCommand";
import { pushCommand } from "./pushCommand";
import { pullCommand } from "./pullCommand";
import { fillCommand } from "./fillCommand";
import { redirectUseIntlayerKeyToDictionary } from "./redirectUseIntlayerKeyToDictionary";
import { replaceConsoleLog } from "./replaceConsoleLog";
import { testCommand } from "./testCommand";

export const activate = (context: ExtensionContext) => {
  replaceConsoleLog();

  // Register the definition provider
  context.subscriptions.push(
    languages.registerDefinitionProvider(
      [
        { language: "javascript", scheme: "file" },
        { language: "javascriptreact", scheme: "file" },
        { language: "typescript", scheme: "file" },
        { language: "typescriptreact", scheme: "file" },
        { language: "vue", scheme: "file" },
      ],
      redirectUseIntlayerKeyToDictionary
    ),

    commands.registerCommand(
      "extension.createDictionaryFile.ts",
      async () => await generateDictionaryContent("ts")
    ),
    commands.registerCommand(
      "extension.createDictionaryFile.esm",
      async () => await generateDictionaryContent("esm")
    ),
    commands.registerCommand(
      "extension.createDictionaryFile.cjs",
      async () => await generateDictionaryContent("cjs")
    ),
    commands.registerCommand(
      "extension.createDictionaryFile.json",
      async () => await generateDictionaryContent("json")
    ),

    commands.registerCommand("extension.buildDictionaries", buildCommand),
    commands.registerCommand("extension.pushDictionaries", pushCommand),
    commands.registerCommand("extension.pullDictionaries", pullCommand),
    commands.registerCommand("extension.fillDictionaries", fillCommand),
    commands.registerCommand("extension.testDictionaries", testCommand)
  );
};
