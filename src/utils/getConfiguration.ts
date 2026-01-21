import { createRequire } from "node:module";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  type GetConfigurationOptions,
  searchConfigurationFile,
} from "@intlayer/config";
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

/**
 * Checks if the Intlayer configuration file contains usage of environment variables.
 * It looks for "process.env" or "import.meta.env".
 */
const checkConfigFileForEnvUsage = (projectDir: string): boolean => {
  try {
    const result = searchConfigurationFile(projectDir);

    if (
      result?.configurationFilePath &&
      existsSync(result.configurationFilePath)
    ) {
      const content = readFileSync(result.configurationFilePath, "utf8");
      // Regex to check for process.env or import.meta.env
      if (/\bprocess\.env\b|\bimport\.meta\.env\b/.test(content)) {
        return true;
      }
    }
  } catch (error) {
    // If search or read fails, assume false
    return false;
  }

  return false;
};

export const getConfigurationOptionsSync = (
  projectDir: string,
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
  logEnvFileName: boolean = true,
): Promise<GetConfigurationOptions> => {
  const env = getSelectedEnvironment(projectDir);
  const cacheKey = `${projectDir}:${env || "default"}`;
  const now = Date.now();

  let additionalEnvVars: Record<string, string> | undefined;

  // Check Cache
  const cached = envCache.get(cacheKey);
  if (cached && now - cached.timestamp < ENV_CACHE_TTL) {
    additionalEnvVars = cached.data;
  } else {
    // Check if Config uses Env Vars
    const hasEnvUsage = checkConfigFileForEnvUsage(projectDir);

    if (hasEnvUsage) {
      // Load Fresh Env Vars if needed
      additionalEnvVars = await loadEnvFromWorkspace(
        projectDir,
        env,
        logEnvFileName,
      );
    }

    // Update Cache (store undefined if not loaded, to avoid re-checking)
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
