import { window } from "vscode";
import { findProjectRoot } from "../tab/findProjectRoot";
import { getConfiguration } from "@intlayer/config";
import { prepareIntlayer } from "@intlayer/chokidar";
import { createRequire } from "module";
import path from "path";
export const buildCommand = async () => {
  const projectDir = findProjectRoot();

  console.log("buildCommand");

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  const projectRequire = createRequire(path.join(projectDir, "package.json"));

  window.showInformationMessage("Building Intlayer dictionaries...");

  try {
    const configuration = getConfiguration({
      baseDir: projectDir,
    });
    await prepareIntlayer(configuration, projectRequire);

    window.showInformationMessage("Intlayer build completed successfully!");
  } catch (error) {
    console.error(error);
    window.showErrorMessage(
      `Intlayer build failed: ${(error as Error).message}`
    );
  }
};
