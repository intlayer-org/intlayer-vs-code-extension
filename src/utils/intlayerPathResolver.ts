import {
  type TextDocument,
  Position,
  commands,
  Location,
  workspace,
} from "vscode";

interface IntlayerOrigin {
  dictionaryKey: string;
  fieldPath: string[];
  moduleSource: string | null; // e.g. "intlayer", "react-intlayer", "next-intlayer/server"
}

export const resolveIntlayerPath = async (
  document: TextDocument,
  position: Position
): Promise<IntlayerOrigin | null> => {
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return null;
  }

  const lineText = document.lineAt(position.line).text;
  const chain = getPropertyChain(lineText, wordRange.end.character);

  if (chain.length > 0) {
    const rootVariable = chain[0];
    const pathFromRoot = chain.slice(1);

    // 1. Find the variable definition (local regex or VS Code definition)
    let definitionInfo = findLocalDefinitionRegex(document, rootVariable);

    if (!definitionInfo) {
      const definition = await findDefinition(document, position, rootVariable);
      if (definition) {
        definitionInfo = parseDefinitionLine(definition.lineText, rootVariable);
      }
    }

    if (definitionInfo) {
      // Find where the function (e.g. useIntlayer) was imported from
      const moduleSource = findImportSource(
        document,
        definitionInfo.functionName
      );

      return {
        dictionaryKey: definitionInfo.dictionaryKey,
        fieldPath: [...definitionInfo.initialPath, ...pathFromRoot],
        moduleSource,
      };
    }
  }

  return null;
};

// --- Helpers ---

const findImportSource = (
  document: TextDocument,
  functionName: string
): string | null => {
  const text = document.getText();
  // Regex to find: import { ... functionName ... } from 'source'
  // Handles multiline imports and aliases roughly
  const regex = new RegExp(
    `import\\s+(?:{[^}]*\\b${functionName}\\b[^}]*}|\\*\\s+as\\s+\\w+|\\w+)\\s+from\\s+['"]([^'"]+)['"]`,
    "g"
  );
  const match = regex.exec(text);
  return match ? match[1] : null;
};

const findLocalDefinitionRegex = (
  document: TextDocument,
  variableName: string
) => {
  const text = document.getText();
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.includes("useIntlayer") || line.includes("getIntlayer")) {
      const parsed = parseDefinitionLine(line, variableName);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
};

const findDefinition = async (
  doc: TextDocument,
  pos: Position,
  variableName: string
): Promise<{ lineText: string; uri: any } | null> => {
  const lineText = doc.lineAt(pos.line).text;
  const regex = new RegExp(`\\b${variableName}\\b`);
  const match = regex.exec(lineText);

  if (!match) {
    return null;
  }

  const definitions = await commands.executeCommand<Location[]>(
    "vscode.executeDefinitionProvider",
    doc.uri,
    new Position(pos.line, match.index)
  );

  if (!definitions || definitions.length === 0) {
    return null;
  }

  const def = definitions[0];
  const defDoc = await workspace.openTextDocument(def.uri);
  return {
    lineText: defDoc.lineAt(def.range.start.line).text,
    uri: def.uri,
  };
};

const getPropertyChain = (text: string, endChar: number): string[] => {
  const subText = text.substring(0, endChar);
  const match = /([a-zA-Z0-9_$]+(\.[a-zA-Z0-9_$]+)*)$/.exec(subText);
  return match ? match[1].split(".") : [];
};

const parseDefinitionLine = (
  line: string,
  targetVar: string
): {
  dictionaryKey: string;
  initialPath: string[];
  functionName: string;
} | null => {
  const regex =
    /(?:const|let|var)\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))(?:\s*:\s*[a-zA-Z0-9_$<>\.,\s]+)?\s*=\s*(useIntlayer|getIntlayer)\(['"]([^'"]+)['"]\)/;

  const match = regex.exec(line);
  if (!match) {
    return null;
  }

  const [_, destructuring, directVar, functionName, key] = match;

  if (directVar && directVar === targetVar) {
    return { dictionaryKey: key, initialPath: [], functionName };
  }

  if (destructuring) {
    const parts = destructuring.split(",");
    for (const part of parts) {
      const p = part.trim();
      const [original, alias] = p.split(":").map((s) => s.trim());
      const effectiveVar = alias || original;

      if (effectiveVar === targetVar) {
        return {
          dictionaryKey: key,
          initialPath: [original],
          functionName,
        };
      }
    }
  }

  return null;
};
