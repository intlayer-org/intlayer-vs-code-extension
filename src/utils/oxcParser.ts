import { parseSync } from "oxc-parser";

export type OxcNode = Record<string, unknown>;

/**
 * Parse source code with oxc (10-20× faster than Babel).
 * Returns the Program node, or null on unrecoverable failure.
 * oxc is error-tolerant and produces a partial AST for in-progress edits.
 */
export const parseFile = (code: string): OxcNode | null => {
  try {
    const { program } = parseSync("file.tsx", code);
    return program as unknown as OxcNode;
  } catch {
    return null;
  }
};

/**
 * Depth-first walk of an oxc AST.
 * Visitor returning `true` prunes that subtree.
 * Primitive-valued keys (start, end, type) are skipped automatically.
 */
export const walkAst = (
  node: unknown,
  visitor: (node: OxcNode) => boolean | undefined,
): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visitor);
    return;
  }
  const n = node as OxcNode;
  if (typeof n["type"] !== "string") return;
  if (visitor(n)) return;
  for (const key of Object.keys(n)) {
    if (key === "start" || key === "end" || key === "type") continue;
    walkAst(n[key], visitor);
  }
};

/** Collect all AST nodes of the given type. */
export const findAllOfType = (root: OxcNode, type: string): OxcNode[] => {
  const results: OxcNode[] = [];
  walkAst(root, (node) => {
    if (node["type"] === type) results.push(node);
    return undefined;
  });
  return results;
};

/**
 * Build a child → parent reference map for upward traversal.
 * Only AST-node-valued properties are followed; primitives are ignored.
 */
export const buildParentMap = (root: OxcNode): Map<OxcNode, OxcNode> => {
  const map = new Map<OxcNode, OxcNode>();
  const walk = (node: unknown, parent: OxcNode | null): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parent);
      return;
    }
    const n = node as OxcNode;
    if (typeof n["type"] !== "string") return;
    if (parent) map.set(n, parent);
    for (const key of Object.keys(n)) {
      if (key === "start" || key === "end" || key === "type") continue;
      walk(n[key], n);
    }
  };
  walk(root, null);
  return map;
};

/**
 * Returns true for nodes that carry a static string value:
 * Literal / StringLiteral (oxc), and no-substitution TemplateLiteral.
 */
export const isStringLiteral = (node: OxcNode): boolean => {
  const t = node["type"] as string;
  if (t === "Literal" || t === "StringLiteral")
    return typeof node["value"] === "string";
  if (t === "TemplateLiteral")
    return ((node["expressions"] as unknown[])?.length ?? 0) === 0;
  return false;
};

/** Extract the static string value from a literal node, or '' if not applicable. */
export const getStringValue = (node: OxcNode): string => {
  const t = node["type"] as string;
  if (t === "Literal" || t === "StringLiteral")
    return typeof node["value"] === "string" ? node["value"] : "";
  if (t === "TemplateLiteral") {
    const quasis = node["quasis"] as OxcNode[] | undefined;
    const val = quasis?.[0]?.["value"] as OxcNode | undefined;
    const cooked = val?.["cooked"] ?? val?.["raw"];
    return typeof cooked === "string" ? cooked : "";
  }
  return "";
};

/** Byte offset of the node's start (compatible with both oxc and Babel estree). */
export const nodeStart = (node: OxcNode): number =>
  (node["start"] as number | undefined) ??
  ((node["range"] as number[] | undefined)?.[0] ?? 0);

/** Byte offset of the node's end (compatible with both oxc and Babel estree). */
export const nodeEnd = (node: OxcNode): number =>
  (node["end"] as number | undefined) ??
  ((node["range"] as number[] | undefined)?.[1] ?? 0);

/** Returns true when `node` is a useIntlayer / getIntlayer CallExpression. */
export const isIntlayerCall = (node: OxcNode): boolean => {
  if (node["type"] !== "CallExpression") return false;
  const callee = node["callee"] as OxcNode | undefined;
  return (
    callee?.["type"] === "Identifier" &&
    (callee["name"] === "useIntlayer" || callee["name"] === "getIntlayer")
  );
};

/** Get the identifier name from a property key node. */
export const getPropertyKeyName = (keyNode: OxcNode): string => {
  const t = keyNode["type"] as string;
  if (t === "Identifier") return keyNode["name"] as string;
  if (t === "Literal" || t === "StringLiteral")
    return String(keyNode["value"] ?? "").replace(/['"]/g, "");
  return "";
};

/**
 * Convert a byte offset into the text to a 0-based {line, character} position.
 * Works the same as VS Code's `document.positionAt` but for a raw string.
 */
export const offsetToLineCol = (
  text: string,
  offset: number,
): { line: number; character: number } => {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const character = offset - (before.lastIndexOf("\n") + 1);
  return { line, character };
};

/**
 * Find the deepest AST node whose span [start, end) contains `offset`.
 * Returns null if no node spans the position.
 */
export const findNodeAtOffset = (
  root: OxcNode,
  offset: number,
): OxcNode | null => {
  let deepest: OxcNode | null = null;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const n = node as OxcNode;
    if (typeof n["type"] !== "string") return;
    const start = n["start"] as number | undefined;
    const end = n["end"] as number | undefined;
    if (start === undefined || end === undefined) return;
    if (start <= offset && offset < end) {
      deepest = n;
      for (const key of Object.keys(n)) {
        if (key === "start" || key === "end" || key === "type") continue;
        walk(n[key]);
      }
    }
  };

  walk(root);
  return deepest;
};
