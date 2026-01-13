import { createRequire } from "node:module";
import { join } from "node:path";
import type { GetConfigurationOptions } from "@intlayer/config";
import { getSelectedEnvironment } from "./envStore";
import { loadEnvFromWorkspace } from "./loadEnvFromWorkspace";
import { logFunctions, prefix } from "./logFunctions";

// --- Cache Definition ---
interface EnvCacheEntry {
  data: Record<string, string> | undefined;
  timestamp: number;
}

// Cache key will be `${projectDir}:${envName}`
const envCache = new Map<string, EnvCacheEntry>();
const ENV_CACHE_TTL = 10 * 60 * 1000; // 10min

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
  const cacheKey = `${projectDir}:${env || "default"}`;
  const now = Date.now();

  let additionalEnvVars: Record<string, string> | undefined;

  // 1. Check Cache
  const cached = envCache.get(cacheKey);
  if (cached && now - cached.timestamp < ENV_CACHE_TTL) {
    additionalEnvVars = cached.data;
  } else {
    // 2. Load Fresh
    additionalEnvVars = await loadEnvFromWorkspace(
      projectDir,
      env,
      logEnvFileName
    );

    // 3. Update Cache
    envCache.set(cacheKey, {
      data: additionalEnvVars,
      timestamp: now,
    });
  }

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
