import { window } from "vscode";

export const logFunctions = {
  info: window.showInformationMessage,
  error: window.showErrorMessage,
  warn: window.showWarningMessage,
};
