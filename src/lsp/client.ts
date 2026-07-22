import { join } from "node:path";
import type { ExtensionContext } from "vscode";
import { window, workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  RevealOutputChannelOn,
  type ServerOptions,
  State,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/**
 * Languages the server is registered for. Kept in sync with the
 * `documentSelector` below — the extension-side providers use it to know
 * whether the server is answering for a given document.
 */
export const LSP_LANGUAGES = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "vue",
  "svelte",
  "astro",
  "html",
  "yaml",
  "markdown",
]);

/** True once the server process is up and answering requests. */
export const isLSPClientRunning = (): boolean =>
  client?.state === State.Running;

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
    documentSelector: [...LSP_LANGUAGES].map((language) => ({
      scheme: "file",
      language,
    })),
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
