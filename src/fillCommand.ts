import { window } from "vscode";
import { fill } from "@intlayer/cli";
import { listDictionaries } from "@intlayer/chokidar";
import { findProjectRoot } from "./findProjectRoot";
import { relative } from "path";
import { getConfiguration, Locales } from "@intlayer/config";

export const fillCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    const configuration = getConfiguration({
      baseDir: projectDir,
    });
    const dictionaries = listDictionaries(configuration);

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

    window.showInformationMessage("filling...");

    for (const { label: dict } of selectedDictionaries) {
      window.showInformationMessage(`Filling ${dict}…`);
      // await each fill before moving on
      try {
        const result = await fill({
          configOptions: { baseDir: projectDir },
          sourceLocale: undefined as unknown as Locales,
          keys: dict,
        });
        window.showInformationMessage(`Result for ${dict}: ${result}`);
      } catch (error) {
        window.showErrorMessage(
          `Intlayer fill failed: ${(error as Error).message}`
        );
      }
    }

    window.showInformationMessage("Intlayer fill completed successfully!");
  } catch (error) {
    window.showErrorMessage(
      `Intlayer fill failed: ${(error as Error).message}`
    );
  }
};
