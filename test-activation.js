
const m = require('module');
const originalRequire = m.prototype.require;
m.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      window: {
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
        createTreeView: () => ({ onDidChangeVisibility: () => ({ dispose: () => {} }) }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
      },
      workspace: {
        workspaceFolders: [],
        fs: {
          readFile: async () => new Uint8Array(),
        },
        findFiles: async () => [],
      },
      languages: {
        registerDefinitionProvider: () => ({ dispose: () => {} }),
        registerHoverProvider: () => ({ dispose: () => {} }),
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
      },
      EventEmitter: class { event = () => {}; fire() {} },
      TreeItem: class {},
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      Uri: { file: (p) => ({ fsPath: p }) },
    };
  }
  return originalRequire.apply(this, arguments);
};
require('./dist/extension.js');
