import { window } from "vscode";

/**
 * Removes ANSI color codes from a string
 */
const stripANSIColors = (text: string): string =>
  // Remove ANSI escape sequences (colors, formatting, etc.)
  text.replace(/\x1b\[[0-9;]*m/g, "");

export const prefix = "Intlayer: ";

export const logFunctions = {
  info: (message: string) =>
    window.showInformationMessage(stripANSIColors(message)),
  error: (message: string) => window.showErrorMessage(stripANSIColors(message)),
  warn: (message: string) =>
    window.showWarningMessage(stripANSIColors(message)),
};
