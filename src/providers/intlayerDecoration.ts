import { dirname, join } from "node:path";
import {
  type TextEditor,
  window,
  workspace,
  Range,
  type DecorationOptions,
  Disposable,
} from "vscode";
import { Project, SyntaxKind, Node, type CallExpression } from "ts-morph";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getCachedConfig, getCachedDictionary } from "../utils/intlayerCache";
import { DefaultValues } from "@intlayer/config";

// --- Configuration ---
const DEBOUNCE_DELAY = 500;
const TRUNCATE_LENGTH = 60;

// Decoration Style: Appears at the end of the line
const translationDecorationType = window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 2ch", // Space between code and text
    color: "rgba(128, 128, 128, 0.3)",
    fontStyle: "italic",
  },
  rangeBehavior: 1, // ClosedOpen
});

// Reusable project for AST parsing
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: { allowJs: true, jsx: 1 },
});

export const intlayerDecorationProvider = (): Disposable[] => {
  let activeEditor = window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined = undefined;

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

const updateDecorations = async (editor: TextEditor) => {
  const document = editor.document;
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

  // Parse File AST
  const sourceFile = project.createSourceFile(
    "temp_decoration.tsx",
    document.getText(),
    {
      overwrite: true,
    }
  );

  const decorations: DecorationOptions[] = [];
  const processedLines = new Set<number>(); // Prevent duplicate decorations on the same line

  // Find all `useIntlayer` calls
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression
  );

  for (const callExpr of callExpressions) {
    const { dictionaryKey, variables } = analyzeUseIntlayerCall(callExpr);

    if (!dictionaryKey || variables.length === 0) {
      continue;
    }

    const dictionaryJsonPath = join(
      config.content.unmergedDictionariesDir,
      `${dictionaryKey}.json`
    );
    const dictionaries = await getCachedDictionary(dictionaryJsonPath);

    if (!dictionaries || dictionaries.length === 0) {
      continue;
    }

    // Use the first valid local dictionary found
    const dictionaryContent = dictionaries[0].content;

    // Iterate through variables destructured from useIntlayer
    for (const { variableName, path: initialPath } of variables) {
      // Find usages of these variables
      const identifiers = sourceFile.getDescendantsOfKind(
        SyntaxKind.Identifier
      );
      const references = identifiers.filter(
        (id) => id.getText() === variableName && !isDeclarationIdentifier(id)
      );

      for (const ref of references) {
        const { fullPath, rangeNode } = resolvePropertyAccess(ref);

        // --- CHANGED: Handle .value / .raw Accessors ---
        // If the path ends in .value or .raw, we remove it because it is an
        // accessor on the Intlayer node, not a key in the dictionary JSON.
        const lastKey = fullPath[fullPath.length - 1];
        if (lastKey === "value" || lastKey === "raw") {
          fullPath.pop();
        }
        // -----------------------------------------------

        const contentPath = [...initialPath, ...fullPath];

        // Retrieve Content
        const rawValue = getValueFromPath(
          dictionaryContent,
          contentPath,
          defaultLocale
        );

        if (rawValue) {
          // Parse content (handles Strings, Numbers, and React Nodes)
          const displayText = parseContentValue(rawValue);

          if (!displayText) {
            continue;
          }

          // Decoration Logic: End of Line
          const nodeEndPos = rangeNode.getEnd();
          const position = document.positionAt(nodeEndPos);
          const lineIndex = position.line;

          // Avoid cluttering if we already have a decoration on this line
          if (processedLines.has(lineIndex)) {
            continue;
          }

          // Create a range at the very end of the line
          const line = document.lineAt(lineIndex);
          const range = new Range(line.range.end, line.range.end);

          decorations.push({
            range,
            renderOptions: {
              after: {
                // Using simple spaces for indentation
                contentText: `    ${displayText}`,
              },
            },
          });

          processedLines.add(lineIndex);
        }
      }
    }
  }

  editor.setDecorations(translationDecorationType, decorations);
};

// --- Content Parsing Helpers ---

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

// --- AST Helpers ---

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

  const variables: { variableName: string; path: string[] }[] = [];
  const varDecl = callExpr.getParentIfKind(SyntaxKind.VariableDeclaration);

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
        });
      }
    } else if (Node.isIdentifier(pattern)) {
      variables.push({
        variableName: pattern.getText(),
        path: [],
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
    Node.isParameterDeclaration(parent)
  ) {
    return true;
  }
  if (Node.isPropertyAssignment(parent)) {
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
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return { fullPath: path, rangeNode: current };
};

const getValueFromPath = (
  content: any,
  path: string[],
  locale: string
): any => {
  let current = content;

  for (const key of path) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }

  if (!current) {
    return null;
  }

  if (
    typeof current === "object" &&
    current.nodeType === "translation" &&
    current.translation
  ) {
    return current.translation[locale] || Object.values(current.translation)[0];
  }

  return current;
};
