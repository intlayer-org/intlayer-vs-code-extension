import { extname } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { getConfiguration } from "@intlayer/config/node";
import { Range, RelativePattern, type Uri, workspace } from "vscode";
import { extractScriptContent } from "./extractScript";
import { getConfigurationOptions } from "./getConfiguration";

export interface ASTNode {
  type?: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  name?: string;
  value?: unknown;
  quasis?: { value?: { cooked?: string } }[];
  expressions?: ASTNode[];
  callee?: ASTNode;
  arguments?: ASTNode[];
  properties?: ASTNode[];
  key?: ASTNode;
  init?: ASTNode;
  id?: ASTNode;
  computed?: boolean;
  object?: ASTNode;
  property?: ASTNode;
  shorthand?: boolean;
  [key: string]: unknown;
}

/**
 * Parses the given TypeScript or JavaScript code into an AST (Abstract Syntax Tree).
 *
 * @param code - The string content of the code to parse.
 * @returns The generated AST node representation.
 */
const parseCode = (code: string): ASTNode =>
  babelParse(code, {
    sourceType: "module",
    strictMode: false,
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    plugins: ["typescript", "jsx", "estree"],
    ranges: true,
  }) as unknown as ASTNode;

/**
 * Builds a Map linking each AST node to its parent node.
 * This is useful to traverse upwards in the AST.
 *
 * @param root - The root AST node to start traversal from.
 * @returns A Map where the keys are child nodes and values are their parent nodes.
 */
const buildParentMap = (root: ASTNode): Map<ASTNode, ASTNode> => {
  const parentMap = new Map<ASTNode, ASTNode>();

  const walk = (node: unknown, parent: ASTNode | null) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach((child) => {
        walk(child, parent);
      });
      return;
    }

    const astNode = node as ASTNode;
    if (!astNode.type) return;

    if (parent) {
      parentMap.set(astNode, parent);
    }

    for (const key of Object.keys(astNode)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      walk(astNode[key], astNode);
    }
  };

  walk(root, null);
  return parentMap;
};

/**
 * Finds all AST nodes of a specific type recursively.
 *
 * @param root - The root AST node to start searching from.
 * @param type - The AST node type string to look for (e.g., 'CallExpression').
 * @returns An array of AST nodes matching the specified type.
 */
const findAllOfType = (root: ASTNode, type: string): ASTNode[] => {
  const results: ASTNode[] = [];

  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;

    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }

    const astNode = n as ASTNode;
    if (!astNode.type) return;

    if (astNode.type === type) results.push(astNode);

    for (const key of Object.keys(astNode)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      walk(astNode[key]);
    }
  };

  walk(root);
  return results;
};

/**
 * Checks if an AST node is a string literal.
 *
 * @param node - The AST node to check.
 * @returns True if the node is a literal with a string value.
 */
const isStringLiteral = (node: ASTNode): boolean =>
  node?.type === "Literal" && typeof node.value === "string";

/**
 * Checks if an AST node is a template literal without substitutions.
 *
 * @param node - The AST node to check.
 * @returns True if the node is a template literal with no expressions.
 */
const isNoSubTemplateLiteral = (node: ASTNode): boolean =>
  node?.type === "TemplateLiteral" &&
  Array.isArray(node.expressions) &&
  node.expressions.length === 0;

/**
 * Extracts the literal string text from an AST node if possible.
 *
 * @param node - The AST node.
 * @returns The extracted string value, or an empty string if not a relevant literal.
 */
const getLiteralText = (node: ASTNode): string => {
  if (node?.type === "Literal") return String(node.value);
  if (node?.type === "TemplateLiteral") {
    const quasis = node.quasis as
      | Array<{ value?: { cooked?: string } }>
      | undefined;
    return quasis?.[0]?.value?.cooked ?? "";
  }
  return "";
};

/**
 * Converts an AST node's location into a VS Code Range.
 *
 * @param node - The AST Node to get location from.
 * @returns The converted Range object.
 */
const nodeToRange = (node: ASTNode): Range => {
  if (!node.loc) {
    return new Range(0, 0, 0, 0); // Graceful fallback
  }
  return new Range(
    node.loc.start.line - 1,
    node.loc.start.column,
    node.loc.end.line - 1,
    node.loc.end.column,
  );
};

export interface UsageLocation {
  uri: Uri;
  range: Range;
  keysUsed: Set<string>;
  keyLocations: Map<string, Range[]>;
}

/**
 * Extracts script content from a given file text, with special handling for Angular templates
 * when the file is a TypeScript component.
 *
 * @param text - The full source code text of the file.
 * @param extension - The extension of the file.
 * @returns The sanitized script content to parse.
 */
const extractScriptContentWithAngular = (
  text: string,
  extension: string,
): string => {
  let processedText = extractScriptContent(text, extension);

  if (extension === ".ts" && text.includes("@Component")) {
    const templateRegex = /template\s*:\s*(["'`])([\s\S]*?)\1/g;

    processedText = processedText.replace(
      templateRegex,
      (_match, _quote, content) => {
        const expressions: string[] = [];
        const sanitize = (e: string) => {
          let s = e;
          s = s.replace(/;/g, ",");
          s = s.replace(/\s+as\s+/g, ",");
          s = s.replace(/\b\w+\s+of\s+/g, "");
          s = s.replace(/\btrack\s+/g, "");
          s = s.replace(/\blet\s+/g, "");
          return s.trim();
        };

        for (const interpolationMatch of content.matchAll(/{{([\s\S]*?)}}/g)) {
          expressions.push(sanitize(interpolationMatch[1]));
        }

        for (const bindingMatch of content.matchAll(
          /(?:\[.*?\]|bind-.*?)\s*=\s*(["'])(.*?)\1/g,
        )) {
          expressions.push(sanitize(bindingMatch[2]));
        }

        for (const structMatch of content.matchAll(
          /\*\w+\s*=\s*(["'])(.*?)\1/g,
        )) {
          expressions.push(sanitize(structMatch[2]));
        }

        for (const controlFlowMatch of content.matchAll(/@\w+\s*\((.*?)\)/g)) {
          expressions.push(sanitize(controlFlowMatch[1]));
        }

        return `template: [${expressions.join(", ")}]`;
      },
    );
  }

  return processedText;
};

/**
 * Analyzes files in a project directory to discover all usages of a specific translation dictionary key.
 *
 * @param projectDir - The absolute path to the project directory to traverse.
 * @param dictionaryKey - The translation key string being searched for.
 * @returns An array of locations detailing where the key was used.
 */
export const findUsagesOfDictionary = async (
  projectDir: string,
  dictionaryKey: string,
): Promise<UsageLocation[]> => {
  const configOptions = await getConfigurationOptions(projectDir);
  getConfiguration(configOptions);

  const searchPattern = new RelativePattern(
    projectDir,
    "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}",
  );

  const relevantFiles = await workspace.findFiles(
    searchPattern,
    "**/node_modules/**",
  );

  const usageLocations: UsageLocation[] = [];

  const CONCURRENCY_LIMIT = 10;
  const chunks: (typeof relevantFiles)[] = [];

  for (let i = 0; i < relevantFiles.length; i += CONCURRENCY_LIMIT) {
    chunks.push(relevantFiles.slice(i, i + CONCURRENCY_LIMIT));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (fileUri) => {
        try {
          const content = await workspace.fs.readFile(fileUri);
          const text = new TextDecoder("utf-8").decode(content);

          if (!text.includes(dictionaryKey)) return;

          const extension = extname(fileUri.fsPath).toLowerCase();
          const scriptContent = extractScriptContentWithAngular(
            text,
            extension,
          );

          let ast: ASTNode;
          try {
            ast = parseCode(scriptContent);
          } catch {
            return;
          }

          const programNode = ast.program as ASTNode;
          const fileUsages = analyzeFileForUsages(programNode, dictionaryKey);

          if (fileUsages.length > 0) {
            const { keys, locations } = mergeUsageData(fileUsages);
            usageLocations.push({
              uri: fileUri,
              range: fileUsages[0].range,
              keysUsed: keys,
              keyLocations: locations,
            });
          }
        } catch (e) {
          console.error(`Error parsing ${fileUri.fsPath}`, e);
        }
      }),
    );
  }

  return usageLocations;
};

/**
 * Consolidates usage data across multiple references to avoid duplicates
 * and merge ranges correctly.
 */
const mergeUsageData = (
  usages: { keysUsed: Set<string>; keyLocations: Map<string, Range[]> }[],
) => {
  const keys = new Set<string>();
  const locations = new Map<string, Range[]>();

  for (const u of usages) {
    u.keysUsed.forEach((k) => {
      keys.add(k);
    });
    u.keyLocations.forEach((ranges, key) => {
      const existing = locations.get(key) || [];
      locations.set(key, [...existing, ...ranges]);
    });
  }

  return { keys, locations };
};

/**
 * Deeply analyzes an AST to trace local usages and references of a specific dictionary key.
 *
 * @param program - The root AST program node.
 * @param targetKey - The key to look for.
 * @returns The gathered keys and ranges tracking exact usage locations.
 */
const analyzeFileForUsages = (
  program: ASTNode,
  targetKey: string,
): {
  range: Range;
  keysUsed: Set<string>;
  keyLocations: Map<string, Range[]>;
}[] => {
  const results: {
    range: Range;
    keysUsed: Set<string>;
    keyLocations: Map<string, Range[]>;
  }[] = [];

  const parentMap = buildParentMap(program);
  const calls = findAllOfType(program, "CallExpression");

  for (const call of calls) {
    const callee = call.callee;

    if (callee?.type !== "Identifier") continue;

    const funcName = callee.name;

    if (funcName !== "useIntlayer" && funcName !== "getIntlayer") continue;

    const args = call.arguments;

    if (args?.length === 0) continue;

    const firstArg = args?.[0];
    let argText = "";

    if (
      firstArg &&
      (isStringLiteral(firstArg) || isNoSubTemplateLiteral(firstArg))
    ) {
      argText = getLiteralText(firstArg);
    }

    if (argText !== targetKey) continue;

    const keysUsed = new Set<string>();
    const keyLocations = new Map<string, Range[]>();
    const declarationRange = nodeToRange(call);

    const addLocation = (key: string, node: ASTNode) => {
      const cleanKey = key.replace(/\.(value|raw)$/, "");
      keysUsed.add(cleanKey);

      const parts = cleanKey.split(".");

      for (let i = 1; i < parts.length; i++) {
        keysUsed.add(parts.slice(0, i).join("."));
      }

      const r = nodeToRange(node);
      const list = keyLocations.get(cleanKey) || [];
      list.push(r);
      keyLocations.set(cleanKey, list);
    };

    const traceUsages = (varName: string, prefix = "") => {
      const allIdentifiers = findAllOfType(program, "Identifier");
      const refs = allIdentifiers.filter((id) => {
        const name = id.name;

        if (name !== varName && name !== `$${varName}`) return false;

        const parent = parentMap.get(id);

        if (!parent) return true;

        if (parent.type === "VariableDeclarator" && parent.id === id)
          return false;

        if (
          parent.type === "Property" &&
          parentMap.get(parent)?.type === "ObjectPattern"
        )
          return false;

        if (parent.type === "PropertyDefinition" && parent.key === id)
          return false;

        return true;
      });

      for (const ref of refs) {
        let current: ASTNode = ref;
        const path: string[] = [];

        while (true) {
          const parent = parentMap.get(current);

          if (
            parent?.type === "MemberExpression" &&
            !parent.computed &&
            parent.object === current
          ) {
            path.push(parent.property?.name ?? "");
            current = parent;
          } else if (
            parent?.type === "MemberExpression" &&
            parent.computed &&
            parent.object === current
          ) {
            const arg = parent.property;

            if (arg && (isStringLiteral(arg) || isNoSubTemplateLiteral(arg))) {
              path.push(getLiteralText(arg));
              current = parent;
            } else {
              keysUsed.add(prefix ? `${prefix}.__ALL__` : "__ALL__");
              break;
            }
          } else if (
            parent?.type === "CallExpression" &&
            parent.callee === current
          ) {
            current = parent;
          } else {
            break;
          }
        }

        if (path.length > 0) {
          const fullKey = prefix
            ? `${prefix}.${path.join(".")}`
            : path.join(".");
          addLocation(fullKey, current);
        } else {
          keysUsed.add(prefix ? `${prefix}.__ALL__` : "__ALL__");
        }
      }
    };

    const callParent = parentMap.get(call);
    const varDecl =
      callParent?.type === "VariableDeclarator" && callParent.init === call
        ? callParent
        : null;
    const propDecl =
      callParent?.type === "PropertyDefinition" && callParent.value === call
        ? callParent
        : null;

    if (!varDecl && !propDecl) {
      keysUsed.add("__EXISTENCE_CHECK__");
      results.push({ range: declarationRange, keysUsed, keyLocations });
      continue;
    }

    if (varDecl) {
      const nameNode = varDecl.id;

      if (nameNode?.type === "ObjectPattern") {
        for (const element of nameNode.properties || []) {
          if (element.type !== "Property") continue;

          const elementKey = element.key as ASTNode | undefined;
          const elementValue = element.value as ASTNode | undefined;

          const key = element.shorthand
            ? elementKey?.name
            : elementKey?.type === "Identifier"
              ? elementKey?.name
              : elementKey
                ? getLiteralText(elementKey)
                : "";
          const varName =
            elementValue?.type === "Identifier" ? elementValue.name : "";

          if (!varName || typeof varName !== "string") continue;

          const finalKey = key || "";

          if (elementKey) {
            addLocation(finalKey, elementKey);
          }
          traceUsages(varName, finalKey);
        }
      } else if (nameNode?.type === "Identifier" && nameNode.name) {
        traceUsages(nameNode.name);
      }
    } else if (propDecl) {
      const nameNode = propDecl.key;

      if (nameNode?.type === "Identifier" && nameNode.name) {
        traceUsages(nameNode.name);
      }
    }

    results.push({ range: declarationRange, keysUsed, keyLocations });
  }

  return results;
};
