import { dirname, join, extname } from "node:path";
import {
  type TextEditor,
  window,
  workspace,
  Range,
  type DecorationOptions,
  Disposable,
} from "vscode";
import {
  Project,
  SyntaxKind,
  Node,
  type ObjectLiteralExpression,
} from "ts-morph";
import { findProjectRoot } from "../utils/findProjectRoot";
import {
  findUsagesOfDictionary,
  type UsageLocation,
} from "../utils/findUsages";
import { getCachedConfig, getCachedDictionary } from "../utils/intlayerCache";
import { extractScriptContent } from "../utils/extractScript";

const DEBOUNCE_DELAY = 1000;

// Reusable project for AST parsing
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: { allowJs: true, jsx: 1 },
});

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
  obj: ObjectLiteralExpression,
  prefix = "",
): { key: string; node: Node }[] => {
  const keys: { key: string; node: Node }[] = [];
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode();
      const name = nameNode.getText().replace(/['"]/g, "");
      const fullKey = prefix ? `${prefix}.${name}` : name;

      const initializer = prop.getInitializer();

      // If it's a translation (t() call), it's a leaf key.

      if (Node.isCallExpression(initializer)) {
        const expr = initializer.getExpression();

        if (expr.getText() === "t") {
          keys.push({ key: fullKey, node: nameNode });
          continue;
        }
      }

      // If it's an object literal, it's a nested group of keys.

      if (Node.isObjectLiteralExpression(initializer)) {
        keys.push({ key: fullKey, node: nameNode });
        keys.push(...getKeysFromObject(initializer, fullKey));
      } else {
        keys.push({ key: fullKey, node: nameNode });
      }
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

  // Basic guard
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

  // Check for Duplicate Definitions (Local or Remote)
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

        // Count "local" and "local&remote" as local duplicates

        if (
          (dict.location === "local" || dict.location === "local&remote") &&
          dict.filePath
        ) {
          // Check if the file path is different from the current one
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

  // --- Cache Lookup for Usages (Code usage) ---
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
    } catch (e) {
      console.error(e);
      return;
    }
  }

  const isDictionaryUsed = usages && usages.length > 0;
  const usedKeys = new Set<string>();
  if (isDictionaryUsed && usages) {
    for (const u of usages) {
      u.keysUsed.forEach((k) => {
        usedKeys.add(k);
      });
    }
  }

  const strikeDecorations: DecorationOptions[] = [];
  const unusedTextDecorations: DecorationOptions[] = [];
  const duplicateDecorations: DecorationOptions[] = [];

  // Add the duplicate decoration if found
  if (duplicateDecoration) {
    duplicateDecorations.push(duplicateDecoration);
  }

  // Helper to push both strike and text decorations
  const addUnused = (range: Range, hover: string) => {
    strikeDecorations.push({ range, hoverMessage: hover });
    const line = document.lineAt(range.start.line);
    unusedTextDecorations.push({
      range: new Range(line.range.end, line.range.end),
    });
  };

  // A. Check Main Dictionary Usage
  // ONLY mark as unused if it is NOT duplicated.
  // If it is duplicated, we already showed the warning above, so we skip the "(unused)" text.
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

  // B. Check Content Keys (Properties)
  // We perform this even if the dictionary itself is duplicated,
  // because specific properties might still be unused in the code.
  const fileName = `temp_unused${extension}${extension === ".vue" || extension === ".svelte" ? ".tsx" : ""}`;
  const existingFile = project.getSourceFile(fileName);
  if (existingFile) {
    project.removeSourceFile(existingFile);
  }
  const sourceFile = project.createSourceFile(fileName, scriptContent);

  const dictionaryObj = sourceFile
    .getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
    .find((obj) => obj.getProperty("key") && obj.getProperty("content"));

  if (dictionaryObj) {
    const contentProp = dictionaryObj.getProperty("content");
    if (Node.isPropertyAssignment(contentProp)) {
      const contentValue = contentProp.getInitializer();

      if (Node.isObjectLiteralExpression(contentValue)) {
        const allKeys = getKeysFromObject(contentValue);

        for (const { key: rawKey, node } of allKeys) {
          // Skip usage check if dictionary itself is completely unused

          if (!isDictionaryUsed) {
            continue;
          }

          // If key is NOT used and we don't have a wildcard usage
          if (!usedKeys.has(rawKey) && !usedKeys.has("__ALL__")) {
            const startPos = document.positionAt(node.getStart());
            const endPos = document.positionAt(node.getEnd());

            addUnused(
              new Range(startPos, endPos),
              `Property '${rawKey}' is unused`,
            );
          }
        }
      }
    }
  }

  // Apply all decorations
  editor.setDecorations(strikeDecorationType, strikeDecorations);
  editor.setDecorations(unusedTextDecorationType, unusedTextDecorations);
  editor.setDecorations(unusedTextDecorationType, duplicateDecorations);
};
