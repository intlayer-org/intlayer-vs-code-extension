import { GetConfigurationOptions } from "@intlayer/config";
import { loadEnvFromWorkspace } from "./loadEnvFromWorkspace";
import { logFunctions, prefix } from "./logFunctions";
import { getSelectedEnvironment } from "./envStore";

export const getConfigurationOptions = async (
  projectDir: string,
  logEnvFileName: boolean = true
): Promise<GetConfigurationOptions> => {
  const env = getSelectedEnvironment(projectDir);
  const additionalEnvVars = await loadEnvFromWorkspace(
    projectDir,
    env,
    logEnvFileName
  );

  const configOptions: GetConfigurationOptions = {
    baseDir: projectDir,
    logFunctions,
    override: {
      log: {
        prefix,
      },
    },
    additionalEnvVars,
  };

  return configOptions;
};
