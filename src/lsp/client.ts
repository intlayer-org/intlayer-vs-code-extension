import { join } from "node:path";
import type { ExtensionContext } from "vscode";
import { window, workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export const startLSPClient = (context: ExtensionContext): void => {
  const serverModule = context.asAbsolutePath(join("dist", "lsp-server.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };

  // Named output channel — visible in VS Code's Output panel drop-down as
  // "Intlayer LSP". All connection.console.log() calls from the server process
  // arrive here. Open it with: View → Output → select "Intlayer LSP".
  const outputChannel = window.createOutputChannel("Intlayer LSP", { log: true });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "vue" },
      { scheme: "file", language: "svelte" },
      { scheme: "file", language: "astro" },
      { scheme: "file", language: "html" },
      { scheme: "file", language: "yaml" },
      { scheme: "file", language: "markdown" },
    ],
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher(
          "**/*.content.{ts,tsx,js,jsx,json,jsonc,json5,yaml,yml,md,mdx}",
        ),
        // The server answers from the built dictionaries, so a rebuild
        // triggered outside the extension (CLI, dev server) must invalidate
        // its caches too — otherwise diagnostics stay stale.
        workspace.createFileSystemWatcher(
          "**/.intlayer/unmerged_dictionary/*.json",
        ),
      ],
    },
    outputChannel,
    // Never auto-reveal — user opens it manually when needed.
    revealOutputChannelOn: RevealOutputChannelOn.Never,
  };

  client = new LanguageClient(
    "intlayerLSP",
    "Intlayer Language Server",
    serverOptions,
    clientOptions,
  );

  client.start();
  context.subscriptions.push(client);
};

export const stopLSPClient = (): Thenable<void> | undefined =>
  client?.stop();
