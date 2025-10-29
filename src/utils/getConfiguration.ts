import { createRequire } from "node:module";
import { join } from "node:path";
import type { GetConfigurationOptions } from "@intlayer/config";
import { getSelectedEnvironment } from "./envStore";
import { loadEnvFromWorkspace } from "./loadEnvFromWorkspace";
import { logFunctions, prefix } from "./logFunctions";

export const getConfigurationOptionsSync = (
  projectDir: string
): GetConfigurationOptions => {
  const projectRequire = createRequire(join(projectDir, "package.json"));

  const configOptions: GetConfigurationOptions = {
    baseDir: projectDir,
    logFunctions,
    override: {
      log: {
        prefix,
      },
    },
    require: projectRequire,
  };

  return configOptions;
};

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

  const projectRequire = createRequire(join(projectDir, "package.json"));

  const configOptions: GetConfigurationOptions = {
    baseDir: projectDir,
    logFunctions,
    override: {
      log: {
        prefix,
      },
    },
    additionalEnvVars,
    require: projectRequire,
  };

  return configOptions;
};
