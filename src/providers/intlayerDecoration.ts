import { dirname, extname, join } from "node:path";
import { DefaultValues } from "@intlayer/config";
import { type CallExpression, Node, Project, SyntaxKind } from "ts-morph";
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

// Reusable project for AST parsing
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: {
    allowJs: true,
    jsx: 1, // JsxEmit.Preserve
    target: 99, // ESNext
  },
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
    config.internationalization?.defaultLocale ||
    DefaultValues.Internationalization.DEFAULT_LOCALE;

  const scriptContent = extractScriptContent(document.getText(), extension);
  const fileName = `temp_decoration${extension}${extension === ".vue" || extension === ".svelte" ? ".tsx" : ""}`;

  // Ensure fresh file in the project
  const existingFile = project.getSourceFile(fileName);
  if (existingFile) {
    project.removeSourceFile(existingFile);
  }

  const sourceFile = project.createSourceFile(fileName, scriptContent);

  const translationDecorations: DecorationOptions[] = [];
  const duplicateDecorations: DecorationOptions[] = [];
  const processedLines = new Set<number>(); // Prevent duplicate decorations on the same line

  // Find all `useIntlayer` calls
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  );

  const variablesMap = new Map<
    string,
    { dictionaryContent: any; defaultLocale: string; initialPath: string[] }
  >();

  // Local cache for dictionaries in this pass
  const localDictionaryCache = new Map<string, any[]>();

  for (const callExpr of callExpressions) {
    const { dictionaryKey, variables } = analyzeUseIntlayerCall(callExpr);

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

    // Logic: Check for Multiple Declarations
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

      const endOffset = callExpr.getEnd();
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

    for (const {
      variableName,
      path: initialPath,
      declarationNode,
    } of variables) {
      variablesMap.set(variableName, {
        dictionaryContent,
        defaultLocale,
        initialPath,
      });

      const identifiers = sourceFile.getDescendantsOfKind(
        SyntaxKind.Identifier,
      );

      const references = identifiers.filter((id) => {
        const idText = id.getText();
        // Support both direct variable access and Svelte's '$' store prefix
        if (idText !== variableName && idText !== `$${variableName}`) {
          return false;
        }
        if (isDeclarationIdentifier(id)) {
          return false;
        }
        if (isPropertyAccessName(id)) {
          return false;
        }

        return true;
      });

      for (const ref of references) {
        const { fullPath, rangeNode } = resolvePropertyAccess(ref);
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

          const nodeEndPos = rangeNode.getEnd();
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
    let match: RegExpExecArray | null = null;
    while (true) {
      match = templateRegex.exec(text);
      if (!match) {
        break;
      }
      const templateStart = match.index + match[0].indexOf(match[2]); // Start of content
      const templateContent = match[2];

      for (const [
        variableName,
        { dictionaryContent, defaultLocale, initialPath },
      ] of variablesMap) {
        // 1. Collect targets (variable + aliases)
        const targets = [{ name: variableName, pathPrefix: [] as string[] }];

        // Alias Regex: variable(...) or variable.path as alias
        // Matches: content as c, content() as c, content().path as p
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

        // 2. Search usages for all targets
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
              defaultLocale,
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

  editor.setDecorations(translationDecorationType, translationDecorations);
  editor.setDecorations(translationDecorationType, duplicateDecorations);
};

// Content Parsing Helpers

/**
 * Extracts a human-readable string from a dictionary value.
 * Handles:
 * 1. Primitives (String, Number)
 * 2. React Element Objects (recursively flattens children)
 */
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
      // It's a React Node structure
      text = extractTextFromReactNode(value);
    } else {
      // Fallback for random objects -> JSON string
      // But we prefer skipping if it's just a structural object (not a leaf)
      return null;
    }
  }

  if (!text) {
    return null;
  }

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Truncate

  if (text.length > TRUNCATE_LENGTH) {
    return `${text.substring(0, TRUNCATE_LENGTH)}...`;
  }
  return text;
};

/**
 * Detects if an object looks like the React Element structure found in dictionaries.
 * Matches structure: { props: { children: ... }, ... }
 */
const isValidElementLike = (obj: any): boolean => {
  return (
    obj &&
    typeof obj === "object" &&
    "props" in obj &&
    // Check for common React internal keys to be sure, or just duck type 'props'
    (!("key" in obj) || obj.key === null || typeof obj.key === "string")
  );
};

/**
 * Recursively extracts text from a React Node object structure.
 */
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

const analyzeUseIntlayerCall = (callExpr: CallExpression) => {
  const expr = callExpr.getExpression();

  if (!Node.isIdentifier(expr)) {
    return { dictionaryKey: null, variables: [] };
  }

  const funcName = expr.getText();

  if (funcName !== "useIntlayer" && funcName !== "getIntlayer") {
    return { dictionaryKey: null, variables: [] };
  }

  const args = callExpr.getArguments();

  if (args.length === 0) {
    return { dictionaryKey: null, variables: [] };
  }

  let dictionaryKey: string | null = null;
  const firstArg = args[0];

  if (
    Node.isStringLiteral(firstArg) ||
    Node.isNoSubstitutionTemplateLiteral(firstArg)
  ) {
    dictionaryKey = firstArg.getLiteralText();
  }

  // variables now includes declarationNode for scope checking
  const variables: {
    variableName: string;
    path: string[];
    declarationNode?: Node;
  }[] = [];

  const varDecl = callExpr.getParentIfKind(SyntaxKind.VariableDeclaration);
  const propDecl = callExpr.getParentIfKind(SyntaxKind.PropertyDeclaration);

  if (varDecl) {
    const pattern = varDecl.getNameNode();

    if (Node.isObjectBindingPattern(pattern)) {
      for (const element of pattern.getElements()) {
        const propNameNode = element.getPropertyNameNode();
        const nameNode = element.getNameNode();
        const dictionaryField = propNameNode
          ? propNameNode.getText()
          : nameNode.getText();
        const variableName = nameNode.getText();

        variables.push({
          variableName,
          path: [dictionaryField],
          declarationNode: nameNode, // Capture the BindingElement identifier
        });
      }
    } else if (Node.isIdentifier(pattern)) {
      variables.push({
        variableName: pattern.getText(),
        path: [],
        declarationNode: pattern, // Capture the Variable declaration identifier
      });
    }
  } else if (propDecl) {
    const nameNode = propDecl.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      variables.push({
        variableName: nameNode.getText(),
        path: [],
        declarationNode: nameNode,
      });
    }
  }

  return { dictionaryKey, variables };
};

const isDeclarationIdentifier = (node: Node) => {
  const parent = node.getParent();

  if (
    Node.isBindingElement(parent) ||
    Node.isVariableDeclaration(parent) ||
    Node.isParameterDeclaration(parent) ||
    Node.isPropertyDeclaration(parent)
  ) {
    return true;
  }

  if (Node.isPropertyAssignment(parent)) {
    return (parent as any).getNameNode() === node;
  }
  return false;
};

const isPropertyAccessName = (node: Node) => {
  const parent = node.getParent();

  if (Node.isPropertyAccessExpression(parent)) {
    return parent.getNameNode() === node;
  }

  if (parent && parent.getKindName() === "JsxMemberExpression") {
    return (parent as any).getNameNode() === node;
  }
  return false;
};

const resolvePropertyAccess = (startNode: Node) => {
  let current = startNode;
  const path: string[] = [];

  while (true) {
    const parent = current.getParent();

    if (Node.isPropertyAccessExpression(parent)) {
      if (parent.getExpression() === current) {
        path.push(parent.getName());
        current = parent;
        continue;
      }
    } else if (Node.isCallExpression(parent)) {
      if (parent.getExpression() === current) {
        current = parent;
        continue;
      }
    }
    break;
  }

  return { fullPath: path, rangeNode: current };
};
