import { extname, resolve } from "node:path";
import fg from "fast-glob";
import { Range, Uri, workspace } from "vscode";
import { extractScriptContent } from "./extractScript";
import { getCachedConfig } from "./intlayerCache";
import {
  buildParentMap,
  findAllOfType,
  getStringValue,
  isIntlayerCall,
  isStringLiteral,
  nodeEnd,
  nodeStart,
  type OxcNode,
  offsetToLineCol,
  parseFile,
} from "./oxcParser";

export interface UsageLocation {
  uri: Uri;
  range: Range;
  keysUsed: Set<string>;
  keyLocations: Map<string, Range[]>;
}

/**
 * Extracts script content from a given file text, with special handling for Angular templates
 * when the file is a TypeScript component.
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

export const findUsagesOfDictionary = async (
  projectDir: string,
  dictionaryKey: string,
): Promise<UsageLocation[]> => {
  const config = await getCachedConfig(projectDir);

  const traversePatterns = (config.build.traversePattern ?? []) as string[];
  const compilerPatterns: string[] = config.compiler.transformPattern
    ? ((Array.isArray(config.compiler.transformPattern)
        ? config.compiler.transformPattern
        : [config.compiler.transformPattern]) as string[])
    : [];

  const allPatterns = [...traversePatterns, ...compilerPatterns].filter(
    (p): p is string => typeof p === "string",
  );
  const includePatterns = allPatterns.filter((p) => !p.startsWith("!"));
  const excludePatterns = [
    ...allPatterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1)),
    ...(config.content.fileExtensions ?? []).map((ext) => `**/*${ext}`),
  ];

  const allRoots = [config.system.baseDir, ...(config.content.codeDir ?? [])];
  const uniqueRoots = [...new Set(allRoots.map((d) => resolve(d)))];

  const seenPaths = new Set<string>();
  const relevantFiles: Uri[] = [];

  for (const root of uniqueRoots) {
    const files = await fg(includePatterns, {
      cwd: root,
      ignore: excludePatterns,
      absolute: true,
      dot: false,
    });
    for (const f of files) {
      if (!seenPaths.has(f)) {
        seenPaths.add(f);
        relevantFiles.push(Uri.file(f));
      }
    }
  }

  const usageLocations: UsageLocation[] = [];
  const CONCURRENCY_LIMIT = 10;
  const chunks: Uri[][] = [];

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
          const scriptContent = extractScriptContentWithAngular(text, extension);

          const program = parseFile(scriptContent);
          if (!program) return;

          const fileUsages = analyzeFileForUsages(program, dictionaryKey, scriptContent);

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

const mergeUsageData = (
  usages: { keysUsed: Set<string>; keyLocations: Map<string, Range[]> }[],
) => {
  const keys = new Set<string>();
  const locations = new Map<string, Range[]>();

  for (const usage of usages) {
    usage.keysUsed.forEach((key) => keys.add(key));
    usage.keyLocations.forEach((ranges, key) => {
      const existing = locations.get(key) ?? [];
      locations.set(key, [...existing, ...ranges]);
    });
  }

  return { keys, locations };
};

const analyzeFileForUsages = (
  program: OxcNode,
  targetKey: string,
  text: string,
): { range: Range; keysUsed: Set<string>; keyLocations: Map<string, Range[]> }[] => {
  const results: { range: Range; keysUsed: Set<string>; keyLocations: Map<string, Range[]> }[] = [];

  const nodeToRange = (node: OxcNode): Range => {
    const s = offsetToLineCol(text, nodeStart(node));
    const e = offsetToLineCol(text, nodeEnd(node));
    return new Range(s.line, s.character, e.line, e.character);
  };

  const parentMap = buildParentMap(program);
  const calls = findAllOfType(program, "CallExpression");

  for (const call of calls) {
    if (!isIntlayerCall(call)) continue;

    const args = call["arguments"] as OxcNode[] | undefined;
    if (!args?.length) continue;

    const firstArg = args[0]!;
    if (!isStringLiteral(firstArg)) continue;

    const argText = getStringValue(firstArg);
    if (argText !== targetKey) continue;

    const keysUsed = new Set<string>();
    const keyLocations = new Map<string, Range[]>();
    const declarationRange = nodeToRange(call);

    const addLocation = (key: string, node: OxcNode) => {
      const cleanKey = key.replace(/\.(value|raw)$/, "");
      keysUsed.add(cleanKey);
      const parts = cleanKey.split(".");
      for (let i = 1; i < parts.length; i++) {
        keysUsed.add(parts.slice(0, i).join("."));
      }
      const r = nodeToRange(node);
      const list = keyLocations.get(cleanKey) ?? [];
      list.push(r);
      keyLocations.set(cleanKey, list);
    };

    const traceUsages = (varName: string, prefix = "") => {
      const allIdentifiers = findAllOfType(program, "Identifier");
      const refs = allIdentifiers.filter((id) => {
        const name = id["name"] as string;
        if (name !== varName && name !== `$${varName}`) return false;

        const parent = parentMap.get(id);
        if (!parent) return true;

        if (parent["type"] === "VariableDeclarator" && parent["id"] === id)
          return false;

        const grandParent = parentMap.get(parent);
        if (
          (parent["type"] === "Property" || parent["type"] === "ObjectProperty") &&
          grandParent?.["type"] === "ObjectPattern"
        )
          return false;

        if (parent["type"] === "PropertyDefinition" && parent["key"] === id)
          return false;

        return true;
      });

      for (const ref of refs) {
        let current: OxcNode = ref;
        const path: string[] = [];

        while (true) {
          const parent = parentMap.get(current);

          if (
            parent?.["type"] === "MemberExpression" &&
            !parent["computed"] &&
            parent["object"] === current
          ) {
            path.push(((parent["property"] as OxcNode)["name"] as string) ?? "");
            current = parent;
          } else if (
            parent?.["type"] === "MemberExpression" &&
            parent["computed"] &&
            parent["object"] === current
          ) {
            const prop = parent["property"] as OxcNode;
            if (isStringLiteral(prop)) {
              path.push(getStringValue(prop));
              current = parent;
            } else {
              keysUsed.add(prefix ? `${prefix}.__ALL__` : "__ALL__");
              break;
            }
          } else if (
            parent?.["type"] === "CallExpression" &&
            parent["callee"] === current
          ) {
            current = parent;
          } else {
            break;
          }
        }

        if (path.length > 0) {
          const fullKey = prefix ? `${prefix}.${path.join(".")}` : path.join(".");
          addLocation(fullKey, current);
        } else {
          keysUsed.add(prefix ? `${prefix}.__ALL__` : "__ALL__");
        }
      }
    };

    const callParent = parentMap.get(call);
    const varDecl =
      callParent?.["type"] === "VariableDeclarator" && callParent["init"] === call
        ? callParent
        : null;
    const propDecl =
      callParent?.["type"] === "PropertyDefinition" && callParent["value"] === call
        ? callParent
        : null;

    if (!varDecl && !propDecl) {
      keysUsed.add("__EXISTENCE_CHECK__");
      results.push({ range: declarationRange, keysUsed, keyLocations });
      continue;
    }

    if (varDecl) {
      const nameNode = varDecl["id"] as OxcNode;

      if (nameNode["type"] === "ObjectPattern") {
        for (const element of (nameNode["properties"] as OxcNode[]) ?? []) {
          if (element["type"] !== "Property" && element["type"] !== "ObjectProperty") continue;

          const elementKey = element["key"] as OxcNode | undefined;
          const elementValue = element["value"] as OxcNode | undefined;

          const key = element["shorthand"]
            ? (elementKey?.["name"] as string | undefined)
            : elementKey?.["type"] === "Identifier"
              ? (elementKey["name"] as string)
              : elementKey
                ? getStringValue(elementKey)
                : "";
          const varName =
            elementValue?.["type"] === "Identifier"
              ? (elementValue["name"] as string)
              : "";

          if (!varName) continue;

          const finalKey = key ?? "";
          if (elementKey) addLocation(finalKey, elementKey);
          traceUsages(varName, finalKey);
        }
      } else if (nameNode["type"] === "Identifier" && nameNode["name"]) {
        traceUsages(nameNode["name"] as string);
      }
    } else if (propDecl) {
      const nameNode = propDecl["key"] as OxcNode | undefined;
      if (nameNode?.["type"] === "Identifier" && nameNode["name"]) {
        traceUsages(nameNode["name"] as string);
      }
    }

    // If the binding was found but no specific field usages were detected, the
    // usages are likely in a template section that was stripped for parsing
    // (Svelte / Vue). Fall back to __ALL__ so that no content fields are falsely
    // decorated as unused.
    if (keysUsed.size === 0 && keyLocations.size === 0) {
      keysUsed.add("__ALL__");
    }

    results.push({ range: declarationRange, keysUsed, keyLocations });
  }

  return results;
};
