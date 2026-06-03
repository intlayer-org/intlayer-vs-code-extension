import { dirname, extname, join } from "node:path";
import { DEFAULT_LOCALE } from "@intlayer/config/defaultValues";
import {
  type DecorationOptions,
  type Disposable,
  Range,
  type TextEditor,
  window,
  workspace,
} from "vscode";
import { extractScriptContent } from "../utils/extractScript";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getCachedConfig, getCachedDictionary } from "../utils/intlayerCache";
import { getValueFromPath } from "../utils/intlayerValueResolver";
import {
  buildParentMap,
  findAllOfType,
  getPropertyKeyName,
  getStringValue,
  isIntlayerCall,
  isStringLiteral,
  nodeEnd,
  type OxcNode,
  parseFile,
} from "../utils/oxcParser";

// Configuration
const DEBOUNCE_DELAY = 500;
const TRUNCATE_LENGTH = 60;

// Decoration Style: Appears at the end of the line (Translation Preview)
const translationDecorationType = window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 1ch",
    color: "rgba(128, 128, 128, 0.3)",
    fontStyle: "italic",
  },
  rangeBehavior: 1, // ClosedOpen
});


export const intlayerDecorationProvider = (): Disposable[] => {
  let activeEditor = window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined;

  const triggerUpdate = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      if (activeEditor) {
        updateDecorations(activeEditor);
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
  ".astro",
];

const updateDecorations = async (editor: TextEditor) => {
  const document = editor.document;

  const extension = extname(document.uri.fsPath).toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    return;
  }

  const filePath = document.uri.fsPath;
  const fileDir = dirname(filePath);
  const projectDir = findProjectRoot(fileDir);

  if (!projectDir) {
    return;
  }

  const config = await getCachedConfig(projectDir);
  const defaultLocale =
    config.internationalization?.defaultLocale || DEFAULT_LOCALE;

  const scriptContent = extractScriptContent(document.getText(), extension);

  const program = parseFile(scriptContent);
  if (!program) return;

  const parentMap = buildParentMap(program);

  const translationDecorations: DecorationOptions[] = [];
  const duplicateDecorations: DecorationOptions[] = [];
  const processedLines = new Set<number>();

  const callExpressions = findAllOfType(program, "CallExpression");

  const variablesMap = new Map<
    string,
    { dictionaryContent: any; defaultLocale: string; initialPath: string[] }
  >();

  const localDictionaryCache = new Map<string, any[]>();

  const identifiers = findAllOfType(program, "Identifier");

  for (const callExpr of callExpressions) {
    const { dictionaryKey, variables } = analyzeUseIntlayerCall(
      callExpr,
      parentMap,
    );

    if (!dictionaryKey) {
      continue;
    }

    let dictionaries = localDictionaryCache.get(dictionaryKey);

    if (!dictionaries) {
      const dictionaryJsonPath = join(
        config.system.unmergedDictionariesDir,
        `${dictionaryKey}.json`,
      );
      dictionaries = (await getCachedDictionary(dictionaryJsonPath)) || [];
      localDictionaryCache.set(dictionaryKey, dictionaries);
    }

    if (!dictionaries || dictionaries.length === 0) {
      continue;
    }

    if (dictionaries.length > 1) {
      let localCount = 0;
      let remoteCount = 0;

      dictionaries.forEach((dictionary) => {
        if (
          dictionary.location === "local" ||
          dictionary.location === "local&remote" ||
          dictionary.location === undefined
        ) {
          localCount++;
        }

        if (dictionary.location === "remote") {
          remoteCount++;
        }
      });

      let label = `(${dictionaries.length} declarations - ${localCount} local`;

      if (remoteCount > 0) {
        label += ` / ${remoteCount} remote`;
      }
      label += `)`;

      const endOffset = nodeEnd(callExpr as OxcNode);
      const position = document.positionAt(endOffset);
      const range = new Range(position, position);

      duplicateDecorations.push({
        range,
        renderOptions: {
          after: {
            contentText: label,
          },
        },
      });
    }

    if (variables.length === 0) {
      continue;
    }

    const dictionaryContent = dictionaries[0].content;

    for (const { variableName, path: initialPath } of variables) {
      variablesMap.set(variableName, {
        dictionaryContent,
        defaultLocale,
        initialPath,
      });

      const references = identifiers.filter((id) => {
        const idText = id["name"] as string;

        if (idText !== variableName && idText !== `$${variableName}`) {
          return false;
        }

        if (isDeclarationIdentifier(id, parentMap)) {
          return false;
        }

        if (isPropertyAccessName(id, parentMap)) {
          return false;
        }
        return true;
      });

      for (const ref of references) {
        const { fullPath, rangeNode } = resolvePropertyAccess(ref, parentMap);
        const contentPath = [...initialPath, ...fullPath];

        const rawValue = getValueFromPath(
          dictionaryContent,
          contentPath,
          defaultLocale,
        );

        if (rawValue) {
          const displayText = parseContentValue(rawValue);

          if (!displayText) {
            continue;
          }

          const nodeEndPos = nodeEnd(rangeNode as OxcNode);
          const position = document.positionAt(nodeEndPos);
          const lineIndex = position.line;

          if (processedLines.has(lineIndex)) {
            continue;
          }

          const line = document.lineAt(lineIndex);
          const range = new Range(line.range.end, line.range.end);

          translationDecorations.push({
            range,
            hoverMessage: displayText,
            renderOptions: {
              after: {
                contentText: `    ${displayText}`,
                color: "rgba(128, 128, 128, 0.3)",
              },
            },
          });
          processedLines.add(lineIndex);
        }
      }
    }
  }

  // Angular Template Logic

  if (extension === ".ts" && document.getText().includes("@Component")) {
    const text = document.getText();
    const templateRegex = /template\s*:\s*(["'`])([\s\S]*?)\1/g;
    let templateMatch: RegExpExecArray | null = null;
    while (true) {
      templateMatch = templateRegex.exec(text);

      if (!templateMatch) {
        break;
      }
      const templateStart =
        templateMatch.index + templateMatch[0].indexOf(templateMatch[2]);
      const templateContent = templateMatch[2];

      for (const [
        variableName,
        { dictionaryContent, defaultLocale: locale, initialPath },
      ] of variablesMap) {
        const targets = [{ name: variableName, pathPrefix: [] as string[] }];

        const aliasPattern = new RegExp(
          `\\b${variableName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\s+as\\s+([a-zA-Z0-9_]+)`,
          "g",
        );

        let aliasMatch: RegExpExecArray | null = null;
        while (true) {
          aliasMatch = aliasPattern.exec(templateContent);

          if (!aliasMatch) {
            break;
          }
          const pathStr = aliasMatch[1];
          const alias = aliasMatch[2];
          const extraPath = pathStr ? pathStr.split(".").filter(Boolean) : [];
          targets.push({ name: alias, pathPrefix: extraPath });
        }

        for (const { name: targetName, pathPrefix } of targets) {
          const usageRegex = new RegExp(
            `\\b${targetName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\b`,
            "g",
          );

          let usageMatch: RegExpExecArray | null = null;
          while (true) {
            usageMatch = usageRegex.exec(templateContent);

            if (!usageMatch) {
              break;
            }
            const fullMatch = usageMatch[0];
            const pathStr = usageMatch[1];
            const keys = pathStr ? pathStr.split(".").filter(Boolean) : [];
            const contentPath = [...initialPath, ...pathPrefix, ...keys];

            const rawValue = getValueFromPath(
              dictionaryContent,
              contentPath,
              locale,
            );

            if (rawValue) {
              const displayText = parseContentValue(rawValue);

              if (displayText) {
                const startOffset = templateStart + usageMatch.index;
                const endOffset = startOffset + fullMatch.length;
                const position = document.positionAt(endOffset);

                const lineIndex = position.line;

                if (processedLines.has(lineIndex)) {
                  continue;
                }

                const line = document.lineAt(lineIndex);
                const range = new Range(line.range.end, line.range.end);

                translationDecorations.push({
                  range,
                  hoverMessage: displayText,
                  renderOptions: {
                    after: {
                      contentText: `    ${displayText}`,
                      color: "rgba(128, 128, 128, 0.3)",
                    },
                  },
                });
                processedLines.add(lineIndex);
              }
            }
          }
        }
      }
    }
  }

  // Vue Template Logic
  // The <template> block was stripped for Babel parsing, so we search it
  // separately with a regex approach (same strategy as Angular templates).
  if (extension === ".vue") {
    const rawText = document.getText();
    const templateBlockMatch =
      /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/i.exec(rawText);

    if (templateBlockMatch) {
      const templateStart =
        templateBlockMatch.index + templateBlockMatch[1].length;
      const templateContent = templateBlockMatch[2];

      for (const [
        variableName,
        { dictionaryContent, defaultLocale: locale, initialPath },
      ] of variablesMap) {
        const targets = [{ name: variableName, pathPrefix: [] as string[] }];

        // Detect v-slot / `as` aliases (e.g. content.title as myTitle)
        const aliasPattern = new RegExp(
          `\\b${variableName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\s+as\\s+([a-zA-Z0-9_]+)`,
          "g",
        );
        let aliasMatch: RegExpExecArray | null = null;
        while (true) {
          aliasMatch = aliasPattern.exec(templateContent);
          if (!aliasMatch) break;
          const extraPath = aliasMatch[1]
            ? aliasMatch[1].split(".").filter(Boolean)
            : [];
          targets.push({ name: aliasMatch[2], pathPrefix: extraPath });
        }

        for (const { name: targetName, pathPrefix } of targets) {
          const usageRegex = new RegExp(
            `\\b${targetName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\b`,
            "g",
          );

          let usageMatch: RegExpExecArray | null = null;
          while (true) {
            usageMatch = usageRegex.exec(templateContent);
            if (!usageMatch) break;

            const fullMatch = usageMatch[0];
            const pathStr = usageMatch[1];
            const keys = pathStr ? pathStr.split(".").filter(Boolean) : [];
            const contentPath = [...initialPath, ...pathPrefix, ...keys];

            const rawValue = getValueFromPath(
              dictionaryContent,
              contentPath,
              locale,
            );

            if (rawValue) {
              const displayText = parseContentValue(rawValue);
              if (displayText) {
                const endOffset =
                  templateStart + usageMatch.index + fullMatch.length;
                const position = document.positionAt(endOffset);
                const lineIndex = position.line;

                if (processedLines.has(lineIndex)) continue;

                const line = document.lineAt(lineIndex);
                const range = new Range(line.range.end, line.range.end);

                translationDecorations.push({
                  range,
                  hoverMessage: displayText,
                  renderOptions: {
                    after: {
                      contentText: `    ${displayText}`,
                      color: "rgba(128, 128, 128, 0.3)",
                    },
                  },
                });
                processedLines.add(lineIndex);
              }
            }
          }
        }
      }
    }
  }

  editor.setDecorations(translationDecorationType, [
    ...translationDecorations,
    ...duplicateDecorations,
  ]);
};

// Content Parsing Helpers

const parseContentValue = (value: any): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  let text = "";

  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number") {
    text = String(value);
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      text = value.map(parseContentValue).join("");
    } else if (isValidElementLike(value)) {
      text = extractTextFromReactNode(value);
    } else {
      return null;
    }
  }

  if (!text) {
    return null;
  }

  text = text.replace(/\s+/g, " ").trim();

  if (text.length > TRUNCATE_LENGTH) {
    return `${text.substring(0, TRUNCATE_LENGTH)}...`;
  }
  return text;
};

const isValidElementLike = (obj: any): boolean =>
  obj &&
  typeof obj === "object" &&
  "props" in obj &&
  (!("key" in obj) || obj.key === null || typeof obj.key === "string");

const extractTextFromReactNode = (node: any): string => {
  if (!node) {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).join("");
  }

  if (typeof node === "object" && node.props && node.props.children) {
    return extractTextFromReactNode(node.props.children);
  }

  return "";
};

const analyzeUseIntlayerCall = (
  callExpr: OxcNode,
  parentMap: Map<OxcNode, OxcNode>,
): {
  dictionaryKey: string | null;
  variables: { variableName: string; path: string[]; declarationNode?: OxcNode }[];
} => {
  if (!isIntlayerCall(callExpr)) return { dictionaryKey: null, variables: [] };

  const args = callExpr["arguments"] as OxcNode[] | undefined;
  if (!args?.length) return { dictionaryKey: null, variables: [] };

  const firstArg = args[0]!;
  const dictionaryKey = isStringLiteral(firstArg) ? getStringValue(firstArg) : null;

  const variables: { variableName: string; path: string[]; declarationNode?: OxcNode }[] = [];

  const callParent = parentMap.get(callExpr);
  const varDecl =
    callParent?.["type"] === "VariableDeclarator" && callParent["init"] === callExpr
      ? callParent
      : null;
  const propDecl =
    callParent?.["type"] === "PropertyDefinition" && callParent["value"] === callExpr
      ? callParent
      : null;

  if (varDecl) {
    const pattern = varDecl["id"] as OxcNode;

    if (pattern["type"] === "ObjectPattern") {
      for (const element of (pattern["properties"] as OxcNode[]) ?? []) {
        // oxc uses "Property" for both object literals and patterns; also "ObjectProperty"
        if (element["type"] !== "Property" && element["type"] !== "ObjectProperty") continue;

        const keyNode = element["key"] as OxcNode;
        const valueNode = element["value"] as OxcNode | undefined;
        const dictionaryField = element["shorthand"]
          ? (keyNode["name"] as string)
          : getPropertyKeyName(keyNode);
        const variableName =
          valueNode?.["type"] === "Identifier" ? (valueNode["name"] as string) : "";

        if (!variableName) continue;

        variables.push({ variableName, path: [dictionaryField], declarationNode: valueNode });
      }
    } else if (pattern["type"] === "Identifier") {
      variables.push({ variableName: pattern["name"] as string, path: [], declarationNode: pattern });
    }
  } else if (propDecl) {
    const nameNode = propDecl["key"] as OxcNode | undefined;
    if (nameNode?.["type"] === "Identifier") {
      variables.push({ variableName: nameNode["name"] as string, path: [], declarationNode: nameNode });
    }
  }

  return { dictionaryKey, variables };
};

const isDeclarationIdentifier = (
  id: OxcNode,
  parentMap: Map<OxcNode, OxcNode>,
): boolean => {
  const parent = parentMap.get(id);
  if (!parent) return false;

  if (parent["type"] === "VariableDeclarator" && parent["id"] === id) return true;

  if (
    (parent["type"] === "Property" || parent["type"] === "ObjectProperty") &&
    parentMap.get(parent)?.["type"] === "ObjectPattern"
  )
    return true;

  if (parent["type"] === "PropertyDefinition") return true;

  if (
    ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
      parent["type"] as string,
    )
  )
    return true;

  if (
    (parent["type"] === "Property" || parent["type"] === "ObjectProperty") &&
    parent["key"] === id &&
    parentMap.get(parent)?.["type"] === "ObjectExpression"
  )
    return true;

  return false;
};

const isPropertyAccessName = (id: OxcNode, parentMap: Map<OxcNode, OxcNode>): boolean => {
  const parent = parentMap.get(id);
  if (!parent) return false;
  if (parent["type"] === "MemberExpression" && parent["property"] === id) return true;
  if (parent["type"] === "JSXMemberExpression" && parent["property"] === id) return true;
  return false;
};

const resolvePropertyAccess = (
  startNode: OxcNode,
  parentMap: Map<OxcNode, OxcNode>,
): { fullPath: string[]; rangeNode: OxcNode } => {
  let current = startNode;
  const path: string[] = [];

  while (true) {
    const parent = parentMap.get(current);

    if (
      parent?.["type"] === "MemberExpression" &&
      !parent["computed"] &&
      parent["object"] === current
    ) {
      path.push((parent["property"] as OxcNode)["name"] as string ?? "");
      current = parent;
    } else if (parent?.["type"] === "CallExpression" && parent["callee"] === current) {
      current = parent;
    } else {
      break;
    }
  }

  return { fullPath: path, rangeNode: current };
};
