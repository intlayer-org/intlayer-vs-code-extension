const m = require('module');
const originalRequire = m.prototype.require;
m.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: { workspaceFolders: [], getWorkspaceFolder: () => null },
      window: { createTreeView: () => ({ onDidChangeVisibility: () => ({ dispose:()=>{} }) }), registerWebviewViewProvider: () => ({ dispose:()=>{} }), onDidChangeActiveTextEditor: () => ({ dispose:()=>{} }), createOutputChannel: () => ({}) },
      languages: { registerDefinitionProvider: () => ({ dispose:()=>{} }), registerHoverProvider: () => ({ dispose:()=>{} }) },
      commands: { registerCommand: () => ({ dispose:()=>{} }) },
      EventEmitter: class { event() {} fire() {} },
      TreeItem: class {},
      TreeItemCollapsibleState: {},
      Uri: { file: (p) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments);
};
require('./dist/extension.js');
