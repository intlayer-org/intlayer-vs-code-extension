import "module-alias/register";

import { commands, type ExtensionContext, languages, window } from "vscode";
import { buildCommand } from "./commands/buildAllCommand";
import { fillCommand } from "./commands/fillAllCommand";
import { pullCommand } from "./commands/pullCommand";
import { pushCommand } from "./commands/pushCommand";
import { selectEnvironment } from "./commands/selectEnvironment";
import { testCommand } from "./commands/testCommand";
import { generateDictionaryContent } from "./createDictionaryContent";
import { buildActiveDictionary } from "./editor/buildActiveDictionary";
import { createDictionaryFile } from "./editor/createDictionaryFile";
import { fillActiveDictionary } from "./editor/fillActiveDictionary";
import { DictionaryTreeDataProvider } from "./explorer/dictionaryExplorer";
import { fillDictionary } from "./explorer/fillDictionary";
import { pullDictionary } from "./explorer/pullDictionary";
import { pushDictionary } from "./explorer/pushDictionary";
import { SearchBarViewProvider } from "./explorer/searchBarViewProvider";
import { redirectUseIntlayerKeyToDictionary } from "./redirectUseIntlayerKeyToDictionary";
import { initializeEnvironmentStore } from "./utils/envStore";

export const activate = (context: ExtensionContext) => {
  initializeEnvironmentStore(context);
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
    commands.registerCommand(
      "extension.buildActiveDictionary",
      buildActiveDictionary
    ),
    commands.registerCommand(
      "extension.fillActiveDictionary",
      fillActiveDictionary
    ),
    commands.registerCommand("extension.pushDictionaries", pushCommand),
    commands.registerCommand("extension.pullDictionaries", pullCommand),
    commands.registerCommand("extension.fillDictionaries", fillCommand),
    commands.registerCommand("extension.testDictionaries", testCommand)
  );

  // Restore native tree for dictionaries and keep a TreeView handle for reveal
  const treeDataProvider = new DictionaryTreeDataProvider();
  const treeView = window.createTreeView("intlayer.dictionaries", {
    treeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    commands.registerCommand("intlayer.refreshDictionaries", () =>
      treeDataProvider.refresh()
    ),
    commands.registerCommand(
      "intlayer.selectEnvironment",
      async (node?: any) =>
        await selectEnvironment(node?.projectDir, treeDataProvider)
    ),
    commands.registerCommand("intlayer.fillDictionary", fillDictionary),
    commands.registerCommand("intlayer.pullDictionary", pullDictionary),
    commands.registerCommand("intlayer.pushDictionary", pushDictionary),
    treeView
  );

  // Keep track of a node we want selected without forcing the view to reveal
  let pendingRevealNode: unknown | undefined;

  // When the tree view becomes visible, reveal the last pending node selection
  context.subscriptions.push(
    treeView.onDidChangeVisibility(async (e) => {
      if (e.visible && pendingRevealNode) {
        try {
          await treeView.reveal(pendingRevealNode as any, {
            select: true,
            focus: false,
            expand: true,
          });
        } catch (_error) {
          // best effort
        } finally {
          pendingRevealNode = undefined;
        }
      }
    })
  );

  context.subscriptions.push(
    window.registerWebviewViewProvider(
      "intlayer.searchBar",
      new SearchBarViewProvider(treeDataProvider)
    )
  );

  // Reveal currently active editor if it matches an unmerged dictionary file path
  const activeEditorDisposable = window.onDidChangeActiveTextEditor(
    async (ed) => {
      try {
        if (!ed) {
          return;
        }
        const node = await treeDataProvider.findFileNodeByAbsolutePath(
          ed.document.uri.fsPath
        );
        if (!node) {
          return;
        }
        // Store the intended selection and only reveal if the view is already visible
        pendingRevealNode = node;
        if (treeView.visible) {
          await treeView.reveal(node, {
            select: true,
            focus: false,
            expand: true,
          });
          pendingRevealNode = undefined;
        }
      } catch (_error) {
        // best effort
      }
    }
  );

  context.subscriptions.push(activeEditorDisposable);

  // Quick create dictionary command with format selection
  context.subscriptions.push(
    commands.registerCommand(
      "extension.createDictionaryFile",
      async () => await createDictionaryFile()
    )
  );
};
