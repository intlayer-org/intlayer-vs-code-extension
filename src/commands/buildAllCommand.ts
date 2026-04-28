import { basename } from "node:path";
import { prepareIntlayer } from "@intlayer/chokidar/build";
import { getConfiguration } from "@intlayer/config/node";
import { window } from "vscode";
import { findAllProjectRoots, findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const buildCommand = async () => {
  let projectDir = findProjectRoot();

  if (!projectDir) {
    const roots = await findAllProjectRoots();
    if (roots.length === 1) {
      projectDir = roots[0];
    } else if (roots.length > 1) {
      const picked = await window.showQuickPick(roots, {
        placeHolder: "Select the Intlayer project to build",
      });
      if (!picked) return;
      projectDir = picked;
    } else {
      await window.showErrorMessage(
        `${prefix}Could not find intlayer project root.`,
      );
      return;
    }
  }

  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);

    await window.showInformationMessage(`${prefix}Building dictionaries...`);
    await prepareIntlayer(configuration);

    const projectName = basename(projectDir);
    await window.showInformationMessage(
      `${prefix}Build completed successfully in ${projectName}`,
    );
  } catch (error) {
    await window.showErrorMessage(
      `${prefix}Build failed: ${(error as Error).message}`,
    );
  }
};
