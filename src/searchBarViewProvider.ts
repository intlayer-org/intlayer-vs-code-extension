import {
  WebviewViewProvider,
  WebviewView,
  WebviewViewResolveContext,
  CancellationToken,
} from "vscode";
import { DictionaryTreeDataProvider } from "./dictionaryExplorer";

export class SearchBarViewProvider implements WebviewViewProvider {
  constructor(private readonly treeDataProvider: DictionaryTreeDataProvider) {}

  resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken
  ) {
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = `<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <style>
              body { margin: 0; padding: 8px; }
              input { width: 100%; box-sizing: border-box; padding: 6px 8px; }
            </style>
          </head>
          <body>
            <input id="q" type="text" placeholder="Search dictionaries..." value="${this.treeDataProvider
              .getSearchQuery()
              .replace(/"/g, "&quot;")}" />
            <script>
              const vscode = acquireVsCodeApi();
              const input = document.getElementById('q');
              let last = input.value || '';
              const post = (value) => vscode.postMessage({ type: 'query', value });
              input.addEventListener('input', () => {
                const v = input.value || '';
                if (v === last) return;
                last = v;
                post(v);
              });
            </script>
          </body>
        </html>`;

    webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "query") {
        const v = typeof msg.value === "string" ? msg.value : "";
        this.treeDataProvider.setSearchQuery(v);
      }
    });
  }
}
