import { extname } from "node:path";
import type { Position, TextDocument } from "vscode";
import { extractScriptContent } from "./extractScript";
import {
  buildParentMap,
  findAllOfType,
  findNodeAtOffset,
  getStringValue,
  isIntlayerCall,
  isStringLiteral,
  type OxcNode,
  parseFile,
} from "./oxcParser";

interface IntlayerOrigin {
  dictionaryKey: string;
  fieldPath: string[];
  moduleSource: string | null;
}

/**
 * Given a cursor position inside a VSCode document, resolves which intlayer
 * dictionary key and field path the hovered expression refers to.
 */
export const resolveIntlayerPath = async (
  document: TextDocument,
  position: Position,
): Promise<IntlayerOrigin | null> => {
  try {
    const fileContent = document.getText();
    const extension = extname(document.uri.fsPath).toLowerCase();
    const scriptContent = extractScriptContent(fileContent, extension);
    const offset = document.offsetAt(position);

    const program = parseFile(scriptContent);

    if (!program) {
      return regexResolveIntlayerPath(fileContent, offset);
    }

    const parentMap = buildParentMap(program);
    const node = findNodeAtOffset(program, offset);

    if (!node) {
      return regexResolveIntlayerPath(fileContent, offset);
    }

    // Hovering over a string literal (e.g. inside useIntlayer('key')) is not actionable.
    if (isStringLiteral(node)) return null;

    const { rootIdentifier, pathFromRoot } = analyzePropertyChain(node, parentMap);

    if (!rootIdentifier) {
      return regexResolveIntlayerPath(fileContent, offset);
    }

    const rawVarName = (rootIdentifier["name"] as string).replace(/^\$/, "");
    const varNames = [
      rawVarName,
      rawVarName.charAt(0).toLowerCase() + rawVarName.slice(1),
      rawVarName.replace(/-([a-z])/g, (_: string, l: string) => l.toUpperCase()),
    ];

    let declaration: OxcNode | null = null;

    // Search VariableDeclarators
    for (const varDecl of findAllOfType(program, "VariableDeclarator")) {
      const nameNode = varDecl["id"] as OxcNode;

      if (nameNode["type"] === "ObjectPattern") {
        const element = (nameNode["properties"] as OxcNode[])?.find(
          (el) =>
            (el["type"] === "Property" || el["type"] === "ObjectProperty") &&
            (el["value"] as OxcNode | undefined)?.["type"] === "Identifier" &&
            varNames.includes((el["value"] as OxcNode)["name"] as string),
        );
        if (element) { declaration = element; break; }
      } else if (
        nameNode["type"] === "Identifier" &&
        varNames.includes(nameNode["name"] as string)
      ) {
        declaration = varDecl;
        break;
      }
    }

    // Fallback: import specifiers
    if (!declaration) {
      for (const stmt of (program["body"] as OxcNode[]) ?? []) {
        if (stmt["type"] !== "ImportDeclaration") continue;
        const namedSpec = (stmt["specifiers"] as OxcNode[])?.find(
          (spec) =>
            spec["type"] === "ImportSpecifier" &&
            varNames.includes((spec["local"] as OxcNode | undefined)?.["name"] as string),
        );
        if (namedSpec) { declaration = namedSpec; break; }
      }
    }

    if (!declaration) {
      return regexResolveIntlayerPath(fileContent, offset);
    }

    let dictionaryKey: string | null = null;
    let initialPath: string[] = [];
    let functionName: string | null = null;

    const declType = declaration["type"] as string;
    if (
      (declType === "Property" || declType === "ObjectProperty") &&
      parentMap.get(declaration)?.["type"] === "ObjectPattern"
    ) {
      const check = analyzeBindingElement(declaration, parentMap);
      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = check.path;
        functionName = check.functionName;
      }
    } else if (declType === "VariableDeclarator") {
      const check = analyzeVariableDeclarator(declaration);
      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = [];
        functionName = check.functionName;
      }
    }

    if (dictionaryKey && functionName) {
      return {
        dictionaryKey,
        fieldPath: [...initialPath, ...pathFromRoot],
        moduleSource: getModuleSource(program, functionName),
      };
    }

    return null;
  } catch (error) {
    console.error("Intlayer AST Resolve Error:", error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const analyzePropertyChain = (
  startNode: OxcNode,
  parentMap: Map<OxcNode, OxcNode>,
): { rootIdentifier: OxcNode | null; pathFromRoot: string[] } => {
  let current = startNode;
  const path: string[] = [];

  while (true) {
    const parent = parentMap.get(current);
    const type = current["type"] as string;

    if (type === "Identifier" || type === "JSXIdentifier") {
      const isPropertyName =
        (parent?.["type"] === "MemberExpression" &&
          !parent["computed"] &&
          parent["property"] === current) ||
        (parent?.["type"] === "JSXMemberExpression" &&
          parent["property"] === current);

      if (isPropertyName) {
        path.unshift(current["name"] as string);
        current = parent!["object"] as OxcNode;
        continue;
      }
      break;
    }

    if (type === "MemberExpression" && !current["computed"]) {
      path.unshift(((current["property"] as OxcNode)["name"] as string) ?? "");
      current = current["object"] as OxcNode;
      continue;
    }

    if (type === "CallExpression") {
      current = current["callee"] as OxcNode;
      continue;
    }

    if (type === "JSXMemberExpression") {
      path.unshift(((current["property"] as OxcNode)["name"] as string) ?? "");
      current = current["object"] as OxcNode;
      continue;
    }

    break;
  }

  const finalType = current["type"] as string;
  if (finalType === "Identifier" || finalType === "JSXIdentifier") {
    return { rootIdentifier: current, pathFromRoot: path };
  }
  return { rootIdentifier: null, pathFromRoot: [] };
};

const analyzeBindingElement = (
  property: OxcNode,
  parentMap: Map<OxcNode, OxcNode>,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  const keyNode = property["key"] as OxcNode | undefined;
  let path: string[] = [];

  if (property["shorthand"] || !keyNode) {
    path = [keyNode?.["name"] as string ?? ""];
  } else if (keyNode["type"] === "Identifier") {
    path = [keyNode["name"] as string];
  } else if (keyNode["type"] === "Literal" || keyNode["type"] === "StringLiteral") {
    path = [String(keyNode["value"] ?? "")];
  }

  const objectPattern = parentMap.get(property);
  if (objectPattern?.["type"] !== "ObjectPattern") return null;

  const varDecl = parentMap.get(objectPattern);
  if (varDecl?.["type"] !== "VariableDeclarator") return null;

  const result = analyzeVariableDeclarator(varDecl);
  return result ? { ...result, path: [...result.path, ...path] } : null;
};

const analyzeVariableDeclarator = (
  decl: OxcNode,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  const initializer = decl["init"] as OxcNode | undefined;
  if (!initializer) return null;

  if (initializer["type"] === "CallExpression") {
    return extractIntlayerInfo(initializer);
  }

  if (initializer["type"] === "AwaitExpression") {
    const expr = initializer["argument"] as OxcNode | undefined;
    if (expr?.["type"] === "CallExpression") return extractIntlayerInfo(expr);
  }

  return null;
};

const extractIntlayerInfo = (
  callExpr: OxcNode,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  if (!isIntlayerCall(callExpr)) return null;

  const callee = callExpr["callee"] as OxcNode;
  const funcName = callee["name"] as string;
  const args = callExpr["arguments"] as OxcNode[] | undefined;

  if (args?.length) {
    const keyArg = args[0]!;
    if (isStringLiteral(keyArg)) {
      return { dictionaryKey: getStringValue(keyArg), functionName: funcName, path: [] };
    }
  }
  return null;
};

const getModuleSource = (program: OxcNode, functionName: string): string | null => {
  for (const stmt of (program["body"] as OxcNode[]) ?? []) {
    if (stmt["type"] !== "ImportDeclaration") continue;
    for (const spec of (stmt["specifiers"] as OxcNode[]) ?? []) {
      if (
        spec["type"] === "ImportSpecifier" &&
        (spec["local"] as OxcNode | undefined)?.["name"] === functionName
      ) {
        return ((stmt["source"] as OxcNode | undefined)?.["value"] as string) ?? null;
      }
    }
  }
  return null;
};

/**
 * Regex fallback for Vue/Svelte/Astro/Angular templates where AST parsing may fail.
 */
function regexResolveIntlayerPath(
  fileContent: string,
  offset: number,
): IntlayerOrigin | null {
  let dictionaryKey: string | null = null;
  let rootVarName: string | null = null;
  let destructuredKeys: string[] = [];

  const hookRegex =
    /(?:const|let|var)\s+(?:([a-zA-Z0-9_$]+)|\{\s*([^}]+)\s*\})\s*=\s*(?:await\s+)?(?:useIntlayer|getIntlayer|useDictionary)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  const match = hookRegex.exec(fileContent);
  if (match !== null) {
    if (match[1]) rootVarName = match[1];
    else if (match[2]) destructuredKeys = match[2].split(",").map((s) => s.split(":")[0].trim());
    dictionaryKey = match[3] ?? null;
  }

  if (!dictionaryKey) {
    const simpleMatch =
      /(?:useIntlayer|getIntlayer|useDictionary)\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(fileContent);
    if (simpleMatch) dictionaryKey = simpleMatch[1] ?? null;
    else return null;
  }

  let start = offset;
  while (start > 0 && /[a-zA-Z0-9_.$]/.test(fileContent[start - 1]!)) start--;
  let end = offset;
  while (end < fileContent.length && /[a-zA-Z0-9_.]/.test(fileContent[end]!)) end++;

  const chainStr = fileContent.slice(start, end);
  if (!chainStr) return null;

  const parts = chainStr.split(".");
  const firstPart = parts[0]!.replace(/^\$/, "");
  let fieldPath: string[] = [];

  if (rootVarName && (firstPart === rootVarName || firstPart === `${rootVarName}Store`)) {
    fieldPath = parts.slice(1);
  } else if (destructuredKeys.includes(firstPart)) {
    fieldPath = parts;
  } else if (parts.length > 1 && (firstPart === "content" || firstPart === "dictionary")) {
    fieldPath = parts.slice(1);
  } else if (parts.length > 0) {
    fieldPath = parts;
  } else {
    return null;
  }

  return { dictionaryKey, fieldPath, moduleSource: null };
}
