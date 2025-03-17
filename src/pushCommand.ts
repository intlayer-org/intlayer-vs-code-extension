import { window } from "vscode";
import { push, getContentDeclaration } from "@intlayer/cli"; // Assume getDictionaries fetches available dictionaries
import { relative } from "path";
import { findProjectRoot } from "./findProjectRoot";

export const pushCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  window.showInformationMessage("Fetching dictionaries...");

  try {
    const dictionaries = getContentDeclaration({
      baseDir: projectDir,
    });

    if (!dictionaries.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    // Show a selection dialog with multiple choices
    const selectedDictionaries = await window.showQuickPick(
      dictionaries
        .map((path) => relative(projectDir, path))
        .map((dict) => ({ label: dict, picked: false })), // Display dictionary names
      {
        canPickMany: true,
        placeHolder: "Select dictionaries to push",
      }
    );

    if (!selectedDictionaries || selectedDictionaries.length === 0) {
      window.showWarningMessage("No dictionary selected.");
      return;
    }

    window.showInformationMessage("Pushing Intlayer project...");

    await push({
      baseDir: projectDir,
      dictionaries: selectedDictionaries.map((d) => d.label),
    });

    window.showInformationMessage("Intlayer push completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer push failed: ${(error as Error).message}`
    );
  }
};
