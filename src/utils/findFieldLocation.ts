import { promises as fs } from "node:fs";
import { extname } from "node:path";
import { parse as babelParse } from "@babel/parser";

export interface ASTNode {
  type?: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  name?: string;
  value?: unknown;
  body?: ASTNode[];
  declarations?: ASTNode[];
  id?: ASTNode;
  key?: ASTNode;
  expression?: ASTNode;
  declaration?: ASTNode;
  init?: ASTNode;
  arguments?: ASTNode[];
  properties?: ASTNode[];
  [key: string]: unknown;
}

const parseCode = (code: string): ASTNode =>
  babelParse(code, {
    sourceType: "module",
    strictMode: false,
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    plugins: ["typescript", "jsx", "estree"],
    ranges: true,
  }) as unknown as ASTNode;

const findVariableDeclarator = (
  program: ASTNode,
  name: string,
): ASTNode | null => {
  if (!program.body) return null;
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration" && stmt.declarations) {
      for (const decl of stmt.declarations) {
        if (decl.id?.type === "Identifier" && decl.id.name === name) {
          return decl;
        }
      }
    }
  }
  return null;
};

const getPropertyKey = (prop: ASTNode): string => {
  const key = prop.key;

  if (!key) return "";

  if (key.type === "Identifier" && typeof key.name === "string")
    return key.name;

  if (key.type === "Literal") return String(key.value);
  return "";
};

const unwrapExpression = (
  node: ASTNode | undefined | null,
): ASTNode | undefined | null => {
  if (
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSAsExpression"
  ) {
    return node.expression;
  }
  return node;
};

export const findFieldLocation = async (
  filePath: string,
  keyPath: string[],
): Promise<{ line: number; character: number } | null> => {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const ext = extname(filePath);

    if ([".json", ".json5", ".jsonc"].includes(ext)) {
      return findLocationInJson(fileContent, keyPath);
    }

    let ast: ASTNode;
    try {
      ast = parseCode(fileContent);
    } catch {
      return null;
    }
    const program = ast.program as ASTNode;

    let rootObject: ASTNode | undefined | null;

    if (!program?.body) return null;

    const exportDefault = program.body.find(
      (n: ASTNode) => n.type === "ExportDefaultDeclaration",
    );

    if (exportDefault) {
      const decl = unwrapExpression(exportDefault.declaration);

      if (decl?.type === "ObjectExpression") {
        rootObject = decl;
      } else if (decl?.type === "Identifier" && typeof decl.name === "string") {
        const varDecl = findVariableDeclarator(program, decl.name);

        if (varDecl) {
          const init = unwrapExpression(varDecl.init);

          if (init?.type === "ObjectExpression") {
            rootObject = init;
          }
        }
      }
    }

    if (!rootObject) {
      return null;
    }

    let currentNode: ASTNode | undefined | null = rootObject;
    let lastFoundNode: ASTNode | undefined | null = null;

    for (const key of keyPath) {
      if (currentNode?.type !== "ObjectExpression") {
        if (currentNode?.type === "CallExpression") {
          const args = currentNode.arguments as ASTNode[] | undefined;

          if (args && args.length > 0 && args[0].type === "ObjectExpression") {
            currentNode = args[0];
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (currentNode?.type === "ObjectExpression") {
        const properties = currentNode.properties as ASTNode[] | undefined;
        const prop = properties?.find(
          (p: ASTNode) => p.type === "Property" && getPropertyKey(p) === key,
        );

        if (!prop) break;

        lastFoundNode = prop;
        currentNode = prop.value as ASTNode | undefined | null;
      }
    }

    if (lastFoundNode?.type === "Property") {
      const keyNode = lastFoundNode.key as ASTNode | undefined;
      if (keyNode?.loc) {
        return {
          line: keyNode.loc.start.line - 1,
          character: keyNode.loc.start.column,
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
  keyPath: string[],
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
