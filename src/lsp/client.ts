import { join } from "node:path";
import type { ExtensionContext } from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
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
      fileEvents: workspace.createFileSystemWatcher(
        "**/*.content.{ts,tsx,js,jsx,json,jsonc,json5,yaml,yml,md,mdx}",
      ),
    },
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
