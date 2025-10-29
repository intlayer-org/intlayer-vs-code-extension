import { basename } from "node:path";
import { prepareIntlayer } from "@intlayer/chokidar";
import { getConfiguration } from "@intlayer/config";
import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const buildCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);

    window.showInformationMessage(`${prefix}Building dictionaries...`);
    await prepareIntlayer(configuration);

    const projectName = basename(projectDir);
    window.showInformationMessage(
      `${prefix}Build completed successfully in ${projectName}`
    );
  } catch (error) {
    window.showErrorMessage(
      `${prefix}Build failed: ${(error as Error).message}`
    );
  }
};
