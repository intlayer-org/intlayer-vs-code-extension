import { getConfiguration } from "@intlayer/config";
import { getConfigurationOptions } from "./getConfiguration";

/**
 * Check if the project has editor.clientId configured
 */
export const hasClientId = async (projectDir: string): Promise<boolean> => {
  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const config = getConfiguration(configOptions);
    return Boolean(config.editor?.clientId && config.editor?.clientSecret);
  } catch {
    return false;
  }
};
