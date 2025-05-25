import { window } from "vscode";

export const replaceConsoleLog = () => {
  // keep the original for debugging or output to the Dev Tools console
  const originalLog = console.log.bind(console);

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
};
