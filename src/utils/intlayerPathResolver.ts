import { type TextDocument, Position } from "vscode";
import {
  Project,
  Node,
  SyntaxKind,
  CallExpression,
  VariableDeclaration,
  BindingElement,
  Identifier,
} from "ts-morph";

// Initialize a lightweight in-memory project for fast AST parsing
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: {
    allowJs: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: 1, // Preserve JSX
  },
});

interface IntlayerOrigin {
  dictionaryKey: string;
  fieldPath: string[];
  moduleSource: string | null;
}

export const resolveIntlayerPath = async (
  document: TextDocument,
  position: Position
): Promise<IntlayerOrigin | null> => {
  try {
    const fileContent = document.getText();
    const filePath = "temp_lookup.tsx"; // Virtual path

    // Create/Update the source file in the virtual project
    const sourceFile = project.createSourceFile(filePath, fileContent, {
      overwrite: true,
    });

    // Get the exact node at the cursor position
    const offset = document.offsetAt(position);
    let node = sourceFile.getDescendantAtPos(offset);

    // If we missed the node (e.g. whitespace), try slightly adjusting or bailing
    if (!node) {
      return null;
    }

    // Handle case where we click inside a string or generic identifier
    // We want to traverse up to find the Identifier node if strictly inside
    if (node.getKind() === SyntaxKind.StringLiteral) {
      return null;
    }

    // 1. Identify the "Root Variable" and the "Path" (e.g. tutoParagraphs.selection.title)
    // If we hover 'title' in 'obj.prop.title', root is 'obj', path is ['prop', 'title']
    const { rootIdentifier, pathFromRoot } = analyzePropertyChain(node);

    if (!rootIdentifier) {
      return null;
    }

    // 2. Trace the Root Identifier to its Definition
    // We use getImplementations() or definitions.
    // In a single-file context, getting the declaration via symbols is usually enough.
    const symbol = rootIdentifier.getSymbol();
    if (!symbol) {
      return null;
    }

    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return null;
    }

    // We typically care about the first declaration (variable definition)
    const declaration = declarations[0];

    // 3. Analyze the Declaration to see if it comes from useIntlayer
    let dictionaryKey: string | null = null;
    let initialPath: string[] = [];
    let functionName: string | null = null;

    if (Node.isBindingElement(declaration)) {
      // Case: const { title, tutoParagraphs } = useIntlayer('key')
      // declaration is 'title' or 'tutoParagraphs'
      const check = analyzeBindingElement(declaration);
      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = check.path;
        functionName = check.functionName;
      }
    } else if (Node.isVariableDeclaration(declaration)) {
      // Case: const content = useIntlayer('key')
      const check = analyzeVariableDeclaration(declaration);
      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = [];
        functionName = check.functionName;
      }
    }

    if (dictionaryKey && functionName) {
      // Success! matches useIntlayer
      // Note: We could check imports here using sourceFile.getImportDeclarations()
      // but verifying the function name is usually sufficient and faster.
      const moduleSource = getModuleSource(sourceFile, functionName);

      return {
        dictionaryKey,
        fieldPath: [...initialPath, ...pathFromRoot],
        moduleSource,
      };
    }

    return null;
  } catch (error) {
    console.error("Intlayer AST Resolve Error:", error);
    return null;
  }
};

// --- Helpers ---

/**
 * Traverses up from the hover node to find the full property access chain.
 * Returns the root identifier (the variable) and the path accessed on it.
 */
const analyzePropertyChain = (
  startNode: Node
): { rootIdentifier: Identifier | null; pathFromRoot: string[] } => {
  let current = startNode;
  const path: string[] = [];

  // Loop to traverse left-upwards until we hit the root object
  while (true) {
    // 1. If we are on an identifier (e.g. 'description' or 'root')
    if (Node.isIdentifier(current)) {
      const parent = current.getParent();

      // Check if this identifier is the property name of a parent PropertyAccess
      // e.g. current='description' in 'edition.description'
      if (
        parent &&
        Node.isPropertyAccessExpression(parent) &&
        parent.getNameNode() === current
      ) {
        // We are on the right side (the property)
        path.unshift(current.getText());
        current = parent.getExpression(); // Move Left to 'edition'
        continue;
      }

      // If we are not the name, we must be the expression (the root)
      // e.g. current='root' in 'root.title'
      break;
    }

    // 2. If we are on a PropertyAccessExpression (e.g. 'edition.title' nested in 'edition.title.desc')
    // This happens when we move left from step 1
    if (Node.isPropertyAccessExpression(current)) {
      // We take the name ('title')
      path.unshift(current.getName());
      // We move left again
      current = current.getExpression();
      continue;
    }

    // If we hit anything else (CallExpression, etc.), stop.
    break;
  }

  // Now 'current' should be the root Identifier
  if (Node.isIdentifier(current)) {
    return { rootIdentifier: current, pathFromRoot: path };
  }

  return { rootIdentifier: null, pathFromRoot: [] };
};

/**
 * Analyzes: const { title } = useIntlayer(...)
 */
const analyzeBindingElement = (element: BindingElement) => {
  // 1. Get the property name (the key in the dictionary)
  // e.g. const { title: myTitle } = ... -> name is 'title'
  // e.g. const { title } = ... -> name is 'title'

  let path: string[] = [];
  const propertyNameNode = element.getPropertyNameNode();
  if (propertyNameNode && Node.isIdentifier(propertyNameNode)) {
    path = [propertyNameNode.getText()];
  } else {
    // Shorthand: const { title }
    path = [element.getName()];
  }

  // 2. Walk up to the VariableDeclaration
  // BindingElement -> ObjectBindingPattern -> VariableDeclaration
  const pattern = element.getParent();
  if (!Node.isObjectBindingPattern(pattern)) {
    return null;
  }

  const varDecl = pattern.getParent();
  if (!Node.isVariableDeclaration(varDecl)) {
    return null;
  }

  // 3. Check Initializer
  const result = analyzeVariableDeclaration(varDecl);
  if (result) {
    return { ...result, path: [...result.path, ...path] }; // Append path
  }
  return null;
};

/**
 * Analyzes: const content = useIntlayer(...)
 */
const analyzeVariableDeclaration = (decl: VariableDeclaration) => {
  const initializer = decl.getInitializer();

  // Handle direct call: useIntlayer(...)
  if (initializer && Node.isCallExpression(initializer)) {
    return extractIntlayerInfo(initializer);
  }

  // Handle await: await useIntlayer(...)
  if (initializer && Node.isAwaitExpression(initializer)) {
    const expression = initializer.getExpression();
    if (Node.isCallExpression(expression)) {
      return extractIntlayerInfo(expression);
    }
  }

  return null;
};

const extractIntlayerInfo = (callExpr: CallExpression) => {
  const expr = callExpr.getExpression();
  if (!Node.isIdentifier(expr)) {
    return null;
  }

  const funcName = expr.getText();
  if (funcName === "useIntlayer" || funcName === "getIntlayer") {
    const args = callExpr.getArguments();
    if (args.length > 0) {
      // First arg should be the key string
      const keyArg = args[0];
      if (
        Node.isStringLiteral(keyArg) ||
        Node.isNoSubstitutionTemplateLiteral(keyArg)
      ) {
        return {
          dictionaryKey: keyArg.getLiteralText(),
          functionName: funcName,
          path: [],
        };
      }
    }
  }
  return null;
};

const getModuleSource = (
  sourceFile: any,
  functionName: string
): string | null => {
  // Simple check for import declaration
  // import { useIntlayer } from 'next-intlayer'
  const imports = sourceFile.getImportDeclarations();
  for (const imp of imports) {
    const namedImports = imp.getNamedImports();
    for (const named of namedImports) {
      if (named.getName() === functionName) {
        return imp.getModuleSpecifierValue();
      }
    }
  }
  return null;
};
