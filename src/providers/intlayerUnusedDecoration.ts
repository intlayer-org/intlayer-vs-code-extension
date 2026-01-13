import { dirname } from "node:path";
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

const DEBOUNCE_DELAY = 1000;

// --- Caching Strategy ---
// We cache usages for a short period to prevent heavy FS scanning on every keystroke
const usageCache = new Map<
  string,
  { timestamp: number; data: UsageLocation[] }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5min

// 1. Strikethrough for the KEY itself
const strikeDecorationType = window.createTextEditorDecorationType({
  textDecoration: "line-through",
  opacity: "0.6",
});

// 2. Text Label at the END of the line
const unusedTextDecorationType = window.createTextEditorDecorationType({
  after: {
    contentText: " (unused)",
    color: "rgba(128, 128, 128, 0.5)",
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

const updateUnusedDecorations = async (editor: TextEditor) => {
  const document = editor.document;
  const text = document.getText();

  // Basic guard
  if (!text.includes("key:") || !text.includes("content:")) {
    return;
  }

  const projectDir = findProjectRoot(dirname(document.uri.fsPath));
  if (!projectDir) {
    return;
  }

  const keyMatch = /key\s*:\s*(["'])(.*?)\1/.exec(text);
  if (!keyMatch) {
    return;
  }
  const dictionaryKey = keyMatch[2];

  // --- Cache Lookup ---
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

  // Collect used keys
  const usedKeys = new Set<string>();
  const isDictionaryUsed = usages && usages.length > 0;

  if (isDictionaryUsed && usages) {
    for (const u of usages) {
      u.keysUsed.forEach((k) => {
        usedKeys.add(k);
      });
    }
  }

  const strikeDecorations: DecorationOptions[] = [];
  const textDecorations: DecorationOptions[] = [];

  // Helper to push both decorations
  const addUnused = (range: Range, hover: string) => {
    // 1. Strikethrough the key range
    strikeDecorations.push({ range, hoverMessage: hover });

    // 2. Add text at end of line
    const line = document.lineAt(range.start.line);
    textDecorations.push({
      range: new Range(line.range.end, line.range.end), // Zero-width range at end of line
    });
  };

  // A. Check Main Dictionary Usage
  if (!isDictionaryUsed) {
    const keyIndex = text.indexOf(keyMatch[0]);
    if (keyIndex !== -1) {
      // Find position of the 'key' property definition
      const startPos = document.positionAt(keyIndex);
      const endPos = document.positionAt(keyIndex + keyMatch[0].length);
      addUnused(
        new Range(startPos, endPos),
        "This dictionary is never used in the project"
      );
    }
  }

  // B. Check Content Keys
  const contentRegex = /content\s*:\s*({[\s\S]*?})/;
  const contentMatch = contentRegex.exec(text);

  if (contentMatch) {
    const contentBlock = contentMatch[1];
    const contentStartIndex =
      contentMatch.index + text.substring(contentMatch.index).indexOf("{");

    // Matches keys like:  title:  or "title":
    const propRegex = /([a-zA-Z0-9_]+|["'][a-zA-Z0-9_]+["'])\s*:/g;

    // Using matchAll to prevent assignment-in-loop lint error
    const matches = contentBlock.matchAll(propRegex);

    for (const match of matches) {
      if (match.index === undefined) {
        continue;
      }

      const rawKey = match[1].replace(/['"]/g, ""); // strip quotes

      // Skip usage check if dictionary itself is unused (already marked whole dict)
      if (!isDictionaryUsed) {
        continue;
      }

      // If key is NOT used and we don't have a wildcard usage
      if (!usedKeys.has(rawKey) && !usedKeys.has("__ALL__")) {
        const absIndex = contentStartIndex + match.index;
        const startPos = document.positionAt(absIndex);
        const endPos = document.positionAt(absIndex + rawKey.length); // Only strike the key name

        addUnused(
          new Range(startPos, endPos),
          `Property '${rawKey}' is unused`
        );
      }
    }
  }

  editor.setDecorations(strikeDecorationType, strikeDecorations);
  editor.setDecorations(unusedTextDecorationType, textDecorations);
};
