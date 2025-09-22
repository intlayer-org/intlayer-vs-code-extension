import { window } from "vscode";

export const replaceConsoleLog = () => {
  // keep the original for debugging or output to the Dev Tools console
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: any[]) => {
    // build a single string message
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // show it in VS Code
    window.showInformationMessage(message);
    // optionally still log to the console (Dev Tools)
    originalLog(message);
  };

  console.info = (...args: any[]) => {
    // build a single string message
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // show it in VS Code
    window.showInformationMessage(message);
    // optionally still log to the console (Dev Tools)
    originalInfo(message);
  };

  console.warn = (...args: any[]) => {
    // build a single string message
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // show it in VS Code
    window.showWarningMessage(message);
    // optionally still log to the console (Dev Tools)
    originalWarn(message);
  };

  console.error = (...args: any[]) => {
    // build a single string message
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // show it in VS Code
    window.showErrorMessage(message);
    // optionally still log to the console (Dev Tools)
    originalError(message);
  };
};
