import { promises as fs, constants } from "node:fs";
import { getConfiguration } from "@intlayer/config";
import type { IntlayerConfig, Dictionary } from "@intlayer/types";
import { getConfigurationOptions } from "./getConfiguration";

// GLOBAL CACHES
let configCache: { path: string; data: IntlayerConfig; lastCheck: number } | null = null;
const dictionaryCache = new Map<string, { mtime: number; data: Dictionary[] }>();

const CACHE_TTL = 2000; // Only check for config updates every 2 seconds

/**
 * Loads configuration with caching. 
 * Prevents re-parsing the config file on every mouse move.
 */
export const getCachedConfig = async (projectDir: string): Promise<IntlayerConfig> => {
  const now = Date.now();
  
  // Return cached config if fresh
  if (configCache && configCache.path === projectDir && (now - configCache.lastCheck < CACHE_TTL)) {
    return configCache.data;
  }

  // Load fresh config
  const configOptions = await getConfigurationOptions(projectDir);
  const config = getConfiguration(configOptions);
  
  configCache = {
    path: projectDir,
    data: config,
    lastCheck: now
  };

  return config;
};

/**
 * Loads a dictionary file with caching and async I/O.
 * Shared between Hover and Definition providers.
 */
export const getCachedDictionary = async (filePath: string): Promise<Dictionary[] | null> => {
  try {
    // 1. Check if file exists (fast)
    await fs.access(filePath, constants.F_OK);

    // 2. Check file stats
    const stats = await fs.stat(filePath);
    const cached = dictionaryCache.get(filePath);

    // 3. Return cache if file hasn't changed
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.data;
    }

    // 4. Read file (Async)
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content) as Dictionary[];

    // 5. Update Cache
    dictionaryCache.set(filePath, {
      mtime: stats.mtimeMs,
      data
    });

    return data;
  } catch (error) {
    console.warn(`Failed to load dictionary: ${filePath}`, error);
    return null;
  }
};