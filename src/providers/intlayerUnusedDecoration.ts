import { dirname, join, extname } from "node:path";
import { parse as babelParse } from "@babel/parser";
import {
  type TextEditor,
  window,
  workspace,
  Range,
  type DecorationOptions,
  Disposable,
} from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import {
  findUsagesOfDictionary,
  type UsageLocation,
} from "../utils/findUsages";
import { getCachedConfig, getCachedDictionary } from "../utils/intlayerCache";
import { extractScriptContent } from "../utils/extractScript";

const DEBOUNCE_DELAY = 1000;

const parseCode = (code: string): any =>
  babelParse(code, {
    sourceType: "module",
    strictMode: false,
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    plugins: ["typescript", "jsx", "estree"],
    ranges: true,
  });

const findAllOfType = (root: any, type: string): any[] => {
  const results: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (!node.type) return;

    if (node.type === type) results.push(node);
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      walk(node[key]);
    }
  };
  walk(root);
  return results;
};

// --- Caching Strategy ---
const usageCache = new Map<
  string,
  { timestamp: number; data: UsageLocation[] }
>();
const CACHE_TTL = 5 * 1000; // 5 sec

// 1. Strikethrough for the KEY itself
const strikeDecorationType = window.createTextEditorDecorationType({
  textDecoration: "line-through",
  opacity: "0.6",
});

// 2. Text Label: Unused
const unusedTextDecorationType = window.createTextEditorDecorationType({
  after: {
    contentText: " (unused)",
    color: "rgba(128, 128, 128, 0.3)",
    fontStyle: "italic",
    margin: "0 0 0 1ch",
  },
});

export const intlayerUnusedDecorationProvider = (): Disposable[] => {
  let activeEditor = window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined = undefined;

  const triggerUpdate = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      if (activeEditor) {
        updateUnusedDecorations(activeEditor);
      }
    }, DEBOUNCE_DELAY);
  };

  if (activeEditor) {
    triggerUpdate();
  }

  return [
    window.onDidChangeActiveTextEditor((editor) => {
      activeEditor = editor;

      if (editor) {
        triggerUpdate();
      }
    }),
    workspace.onDidChangeTextDocument((event) => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdate();
      }
    }),
  ];
};

const getKeysFromObject = (
  obj: any,
  prefix = "",
): { key: string; node: any }[] => {
  const keys: { key: string; node: any }[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;

    const nameNode = prop.key;
    const name =
      nameNode.type === "Identifier"
        ? nameNode.name
        : nameNode.type === "Literal"
          ? String(nameNode.value).replace(/['"]/g, "")
          : "";
    const fullKey = prefix ? `${prefix}.${name}` : name;

    const initializer = prop.value;

    if (initializer?.type === "CallExpression") {
      const callee = initializer.callee;

      if (callee?.type === "Identifier" && callee.name === "t") {
        keys.push({ key: fullKey, node: nameNode });
        continue;
      }
    }

    if (initializer?.type === "ObjectExpression") {
      keys.push({ key: fullKey, node: nameNode });
      keys.push(...getKeysFromObject(initializer, fullKey));
    } else {
      keys.push({ key: fullKey, node: nameNode });
    }
  }
  return keys;
};

const allowedExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".json5",
  ".vue",
  ".svelte",
];

const updateUnusedDecorations = async (editor: TextEditor) => {
  const document = editor.document;

  const extension = extname(document.uri.fsPath).toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    return;
  }

  const text = document.getText();

  if (!text.includes("key:") || !text.includes("content:")) {
    return;
  }

  const projectDir = findProjectRoot(dirname(document.uri.fsPath));

  if (!projectDir) {
    return;
  }

  const scriptContent = extractScriptContent(text, extension);

  const keyMatch = /key\s*:\s*(["'])(.*?)\1/.exec(text);

  if (!keyMatch) {
    return;
  }
  const dictionaryKey = keyMatch[2];
  const keyIndex = text.indexOf(keyMatch[0]);

  let isDuplicated = false;
  let duplicateDecoration: DecorationOptions | null = null;

  try {
    const config = await getCachedConfig(projectDir);
    const dictionaryJsonPath = join(
      config.system.unmergedDictionariesDir,
      `${dictionaryKey}.json`,
    );
    const existingDictionaries = await getCachedDictionary(dictionaryJsonPath);

    if (existingDictionaries && existingDictionaries.length > 0) {
      const currentAbsPath = document.uri.fsPath;
      let localDuplicates = 0;
      let remoteDuplicates = 0;

      for (const dict of existingDictionaries) {
        if (dict.location === "remote") {
          remoteDuplicates++;
        }

        if (
          (dict.location === "local" || dict.location === "local&remote") &&
          dict.filePath
        ) {
          const dictAbsPath = join(projectDir, dict.filePath);

          if (dictAbsPath !== currentAbsPath) {
            localDuplicates++;
          }
        }
      }

      const totalOther = localDuplicates + remoteDuplicates;

      if (totalOther > 0) {
        isDuplicated = true;
        let label = `(used by ${totalOther} more`;

        if (localDuplicates > 0) {
          label += ` - ${localDuplicates} local`;
        }

        if (remoteDuplicates > 0) {
          label += ` - ${remoteDuplicates} remote`;
        }
        label += ")";

        if (keyIndex !== -1) {
          const line = document.lineAt(document.positionAt(keyIndex).line);
          duplicateDecoration = {
            range: new Range(line.range.end, line.range.end),
            renderOptions: {
              after: { contentText: label },
            },
          };
        }
      }
    }
  } catch (error) {
    console.error("Error checking for duplicates:", error);
  }

  const cacheKey = `${projectDir}:${dictionaryKey}`;
  const now = Date.now();
  let usages: UsageLocation[] | undefined;

  const cached = usageCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    usages = cached.data;
  } else {
    try {
      usages = await findUsagesOfDictionary(projectDir, dictionaryKey);
      usageCache.set(cacheKey, { timestamp: now, data: usages });
    } catch (error) {
      console.error(error);
      return;
    }
  }

  const isDictionaryUsed = usages && usages.length > 0;
  const usedKeys = new Set<string>();

  if (isDictionaryUsed && usages) {
    for (const usage of usages) {
      usage.keysUsed.forEach((keyItem) => {
        usedKeys.add(keyItem);
      });
    }
  }

  const strikeDecorations: DecorationOptions[] = [];
  const unusedTextDecorations: DecorationOptions[] = [];
  const duplicateDecorations: DecorationOptions[] = [];

  if (duplicateDecoration) {
    duplicateDecorations.push(duplicateDecoration);
  }

  const addUnused = (range: Range, hover: string) => {
    strikeDecorations.push({ range, hoverMessage: hover });
    const line = document.lineAt(range.start.line);
    unusedTextDecorations.push({
      range: new Range(line.range.end, line.range.end),
    });
  };

  if (!isDictionaryUsed && !isDuplicated) {
    if (keyIndex !== -1) {
      const startPos = document.positionAt(keyIndex);
      const endPos = document.positionAt(keyIndex + keyMatch[0].length);
      addUnused(
        new Range(startPos, endPos),
        "This dictionary is never used in the project",
      );
    }
  }

  let ast: any;
  try {
    ast = parseCode(scriptContent);
  } catch {
    editor.setDecorations(strikeDecorationType, strikeDecorations);
    editor.setDecorations(unusedTextDecorationType, unusedTextDecorations);
    editor.setDecorations(unusedTextDecorationType, duplicateDecorations);
    return;
  }

  const program = ast.program;

  const dictionaryObj = findAllOfType(program, "ObjectExpression").find(
    (obj: any) => {
      const propNames = obj.properties
        .filter((prop: any) => prop.type === "Property")
        .map((prop: any) =>
          prop.key?.type === "Identifier"
            ? prop.key.name
            : String(prop.key?.value ?? ""),
        );
      return propNames.includes("key") && propNames.includes("content");
    },
  );

  if (dictionaryObj) {
    const contentProp = dictionaryObj.properties.find(
      (prop: any) =>
        prop.type === "Property" &&
        (prop.key?.name === "content" || String(prop.key?.value) === "content"),
    );

    if (contentProp?.type === "Property") {
      const contentValue = contentProp.value;

      if (contentValue?.type === "ObjectExpression") {
        const allKeys = getKeysFromObject(contentValue);

        for (const { key: rawKey, node } of allKeys) {
          if (!isDictionaryUsed) {
            continue;
          }

          if (!usedKeys.has(rawKey) && !usedKeys.has("__ALL__")) {
            const startPos = document.positionAt(node.range[0]);
            const endPos = document.positionAt(node.range[1]);

            addUnused(
              new Range(startPos, endPos),
              `Property '${rawKey}' is unused`,
            );
          }
        }
      }
    }
  }

  editor.setDecorations(strikeDecorationType, strikeDecorations);
  editor.setDecorations(unusedTextDecorationType, unusedTextDecorations);
  editor.setDecorations(unusedTextDecorationType, duplicateDecorations);
};
