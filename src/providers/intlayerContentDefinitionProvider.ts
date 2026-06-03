import { dirname, extname } from "node:path";
import {
  findContentFieldAtOffset,
  findKeyInContentFile,
} from "@intlayer/lsp/utils";
import {
  type DefinitionProvider,
  Location,
  type Position,
  type TextDocument,
} from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import {
  findUsagesOfDictionary,
  type UsageLocation,
} from "../utils/findUsages";

const usageCache = new Map<
  string,
  { timestamp: number; data: UsageLocation[] }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5min

export const intlayerContentDefinitionProvider: DefinitionProvider = {
  provideDefinition: async (document: TextDocument, position: Position) => {
    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);

    if (!projectDir) {
      return null;
    }

    const target = await getTargetKeyAndPathFromDocument(document, position);
    if (!target) {
      return null;
    }

    const { dictionaryKey, clickedField } = target;

    // --- Cache Lookup ---
    const cacheKey = `${projectDir}:${dictionaryKey}`;
    const now = Date.now();
    let usages: UsageLocation[] | undefined;

    const cached = usageCache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      usages = cached.data;
    } else {
      usages = await findUsagesOfDictionary(projectDir, dictionaryKey);
      usageCache.set(cacheKey, { timestamp: now, data: usages });
    }

    if (!usages || usages.length === 0) {
      return null;
    }

    const locations: Location[] = [];

    for (const usage of usages) {
      // 1. Clicked the main key: show where the dictionary is instantiated
      if (clickedField === "key") {
        locations.push(new Location(usage.uri, usage.range));
        continue;
      }

      // 2. Clicked a specific field (e.g. 'title')

      // Check for precise locations first
      const preciseRanges = usage.keyLocations.get(clickedField);

      if (preciseRanges && preciseRanges.length > 0) {
        // Add all specific property accesses (e.g. content.title)
        preciseRanges.forEach((range) => {
          locations.push(new Location(usage.uri, range));
        });
      }
      // Fallback: if we know the key is used via __ALL__ (spread/pass-through) but have no specific location
      else if (usage.keysUsed.has("__ALL__")) {
        locations.push(new Location(usage.uri, usage.range));
      }
    }

    return locations.length > 0 ? locations : null;
  },
};

const getTargetKeyAndPathFromDocument = async (
  document: TextDocument,
  position: Position,
): Promise<{ dictionaryKey: string; clickedField: string } | null> => {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const ext = extname(document.uri.fsPath);

  const clickedKey = findKeyInContentFile(text, offset);
  if (clickedKey) {
    return { dictionaryKey: clickedKey, clickedField: "key" };
  }

  const contentField = findContentFieldAtOffset(text, offset, ext);
  if (contentField) {
    return {
      dictionaryKey: contentField.dictionaryKey,
      clickedField: contentField.fieldName,
    };
  }

  return null;
};
