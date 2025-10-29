import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CancellationToken,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from "vscode";
import type { DictionaryTreeDataProvider } from "./dictionaryExplorer";

export class SearchBarViewProvider implements WebviewViewProvider {
  constructor(private readonly treeDataProvider: DictionaryTreeDataProvider) {}

  resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken
  ) {
    const searchHTMLInput = readFileSync(
      join(__dirname, "searchInput.html"),
      "utf8"
    ).replace(
      "{{searchQuery}}",
      this.treeDataProvider.getSearchQuery().replace(/"/g, "&quot;")
    );

    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = searchHTMLInput;

    webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "query") {
        const v = typeof msg.value === "string" ? msg.value : "";
        this.treeDataProvider.setSearchQuery(v);
        return;
      }
      if (msg?.type === "refresh") {
        this.treeDataProvider.refresh();
        return;
      }
    });
  }
}
