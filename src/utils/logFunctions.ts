import { window } from "vscode";

/**
 * Removes ANSI color codes from a string
 */
const stripANSIColors = (text: string): string =>
  // Remove ANSI escape sequences (colors, formatting, etc.)
  text.replace(/\x1b\[[0-9;]*m/g, "");

export const prefix = "Intlayer: ";

const formatMessage = (...message: Parameters<typeof console.log>): string =>
  stripANSIColors(
    (Array.isArray(message) ? message : [message]).flat().join(" ")
  );

export const logFunctions = {
  log: (...message: Parameters<typeof console.log>) => {
    console.log(message);

    window.showInformationMessage(formatMessage(message));
  },
  info: (...message: Parameters<typeof console.log>) => {
    console.log(message);

    window.showInformationMessage(formatMessage(message));
  },
  error: (...message: Parameters<typeof console.log>) => {
    console.log(message);

    window.showErrorMessage(formatMessage(message));
  },
  warn: (...message: Parameters<typeof console.log>) => {
    console.log(message);

    window.showWarningMessage(formatMessage(message));
  },
};
