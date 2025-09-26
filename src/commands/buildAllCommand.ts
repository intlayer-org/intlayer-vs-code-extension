import { window } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfiguration } from "@intlayer/config";
import { prepareIntlayer } from "@intlayer/chokidar";
import { createRequire } from "module";
import { basename, join } from "path";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

export const buildCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const projectRequire = createRequire(join(projectDir, "package.json"));
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);

    window.showInformationMessage(`${prefix}Building dictionaries...`);
    await prepareIntlayer(configuration, projectRequire);

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
