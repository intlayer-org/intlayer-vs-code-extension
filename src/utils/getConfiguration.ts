import { GetConfigurationOptions } from "@intlayer/config";
import { loadEnvFromWorkspace } from "./loadEnvFromWorkspace";
import { logFunctions } from "./logFunctions";
import { getSelectedEnvironment } from "./envStore";

export const getConfigurationOptions = async (
  projectDir: string
): Promise<GetConfigurationOptions> => {
  const env = getSelectedEnvironment(projectDir);
  const additionalEnvVars = await loadEnvFromWorkspace(projectDir, env);

  const configOptions: GetConfigurationOptions = {
    baseDir: projectDir,
    logFunctions,
    additionalEnvVars,
  };

  return configOptions;
};
