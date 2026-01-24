import { dirname, join, extname } from "node:path";
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
import { getValueFromPath } from "../utils/intlayerValueResolver";
import { extractScriptContent } from "../utils/extractScript";

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

// Decoration Style for Multiple Declarations warning
const duplicateDecorationType = window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 2ch",
    color: "rgba(255, 165, 0, 0.6)", // Orange-ish
    fontStyle: "italic",
  },
  rangeBehavior: 1,
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

  for (const callExpr of callExpressions) {
    const { dictionaryKey, variables } = analyzeUseIntlayerCall(callExpr);

    if (!dictionaryKey) {
      continue;
    }

    const dictionaryJsonPath = join(
      config.system.unmergedDictionariesDir,
      `${dictionaryKey}.json`,
    );
    const dictionaries = await getCachedDictionary(dictionaryJsonPath);

    if (!dictionaries || dictionaries.length === 0) {
      continue;
    }

    // Logic: Check for Multiple Declarations
    if (dictionaries.length > 1) {
      let localCount = 0;
      let remoteCount = 0;

      dictionaries.forEach((d) => {
        if (d.location === "local" || d.location === "local&remote") {
          localCount++;
        }
        if (d.location === "remote") {
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
      const identifiers = sourceFile.getDescendantsOfKind(
        SyntaxKind.Identifier,
      );

      const references = identifiers.filter((id) => {
        const idText = id.getText();
        // Support both direct variable access and Svelte's '$' store prefix
        if (idText !== variableName && idText !== "$" + variableName) {
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
        }
      }
    }
  }

  editor.setDecorations(translationDecorationType, translationDecorations);
  editor.setDecorations(duplicateDecorationType, duplicateDecorations);
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
