import { Project, SyntaxKind, Node } from "ts-morph";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

// Keep project instance outside to reuse it (performance)
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: { allowJs: true },
});

export const findFieldLocation = async (
  filePath: string,
  keyPath: string[]
): Promise<{ line: number; character: number } | null> => {
  try {
    const fileContent = readFileSync(filePath, "utf8");
    const ext = extname(filePath);

    // JSON Handler
    if ([".json", ".json5", ".jsonc"].includes(ext)) {
      return findLocationInJson(fileContent, keyPath);
    }

    // Create TS/JS SourceFile
    const sourceFile = project.createSourceFile(filePath, fileContent, {
      overwrite: true,
    });

    let rootObject: Node | undefined;

    // 1. Check Default Export
    const exportDefault = sourceFile.getExportAssignment(
      (e) => !e.isExportEquals()
    );

    if (exportDefault) {
      const expression = exportDefault.getExpression();

      if (expression.getKind() === SyntaxKind.ObjectLiteralExpression) {
        // Case: export default { ... }
        rootObject = expression;
      } else if (expression.getKind() === SyntaxKind.Identifier) {
        // Case: const content = { ... }; export default content;
        const identifierName = expression.getText();

        // Find the variable declaration
        const variableDecl = sourceFile.getVariableDeclaration(identifierName);
        if (variableDecl) {
          const initializer = variableDecl.getInitializer();
          if (
            initializer &&
            initializer.getKind() === SyntaxKind.ObjectLiteralExpression
          ) {
            rootObject = initializer;
          } else if (
            initializer &&
            initializer.getKind() === SyntaxKind.SatisfiesExpression
          ) {
            // Case: const content = { ... } satisfies Dictionary;
            const expression = (initializer as any).getExpression();
            if (
              expression &&
              expression.getKind() === SyntaxKind.ObjectLiteralExpression
            ) {
              rootObject = expression;
            }
          }
        }
      } else if (expression.getKind() === SyntaxKind.SatisfiesExpression) {
        // Case: export default { ... } satisfies Dictionary
        const inner = (expression as any).getExpression();
        if (inner.getKind() === SyntaxKind.ObjectLiteralExpression) {
          rootObject = inner;
        }
      }
    }

    if (!rootObject) {
      return null;
    }

    // Traverse the Object Literal
    let currentNode = rootObject;
    let lastFoundNode: Node | null = null;

    for (const key of keyPath) {
      // Handle "content" key wrapper usually present in Intlayer dictionaries
      // But also handle function calls like t({})

      if (currentNode.getKind() !== SyntaxKind.ObjectLiteralExpression) {
        // Unwrap t({ ... })
        if (currentNode.getKind() === SyntaxKind.CallExpression) {
          const args = (currentNode as any).getArguments();
          if (
            args.length > 0 &&
            args[0].getKind() === SyntaxKind.ObjectLiteralExpression
          ) {
            currentNode = args[0];
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (currentNode.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const prop = (currentNode as any).getProperty(key);
        if (!prop) {
          break;
        }

        // We found a match for this key
        lastFoundNode = prop; // The property assignment node
        currentNode = prop.getInitializer(); // Move to value
      }
    }

    // If we found something, return its key position
    if (lastFoundNode) {
      // lastFoundNode is typically a PropertyAssignment
      if (lastFoundNode.getKind() === SyntaxKind.PropertyAssignment) {
        const nameNode = (lastFoundNode as any).getNameNode();
        return {
          line: nameNode.getStartLineNumber() - 1,
          // FIX: Calculate column by subtracting line start position from node start position
          character: nameNode.getStart() - nameNode.getStartLinePos(),
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Error finding field location:", error);
    return null;
  }
};

const findLocationInJson = (
  content: string,
  keyPath: string[]
): { line: number; character: number } | null => {
  let currentIndex = 0;
  let resultLine = 0;
  let resultChar = 0;

  for (const key of keyPath) {
    const regex = new RegExp(`(["'])${key}\\1\\s*:`, "g");
    regex.lastIndex = currentIndex;
    const match = regex.exec(content);
    if (!match) {
      return null;
    }
    currentIndex = match.index + match[0].length;

    const contentUpToMatch = content.substring(0, match.index);
    const lines = contentUpToMatch.split("\n");
    resultLine = lines.length - 1;
    resultChar = lines[lines.length - 1].length;
  }
  return { line: resultLine, character: resultChar };
};
