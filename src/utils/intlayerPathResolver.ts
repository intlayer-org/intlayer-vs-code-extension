import { type TextDocument, Position } from "vscode";
import { extname } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { extractScriptContent } from "./extractScript";

// Parse source code using @babel/parser with the `estree` plugin so that node
// types stay ESTree-compatible (e.g. `Literal` rather than `StringLiteral`).
// `ranges: true` attaches `node.range = [start, end]` offsets to every node.
const parseCode = (code: string): any =>
  babelParse(code, {
    sourceType: "module",
    strictMode: false,
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    plugins: ["typescript", "jsx", "estree"],
    ranges: true,
  });

/**
 * Builds a child → parent reference map by doing a single depth-first walk of
 * the AST. This lets any node look up its parent in O(1) without ts-morph's
 * built-in `getParent()`.
 *
 * Skips the synthetic `parent`, `tokens`, and `comments` keys that some
 * parsers attach to avoid infinite recursion.
 */
const buildParentMap = (root: any): Map<any, any> => {
  const parentMap = new Map<any, any>();
  const walk = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach((child) => {
        walk(child, parent);
      });
      return;
    }

    if (!node.type) return;
    parentMap.set(node, parent);

    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      walk(node[key], node);
    }
  };
  walk(root, null);
  return parentMap;
};

/**
 * Collects every AST node whose `type` field matches `type` by walking the
 * entire subtree rooted at `root`.
 */
const findAllOfType = (root: any, type: string): any[] => {
  const results: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (!node.type) return;

    if (node.type === type) results.push(node);

    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      walk(node[key]);
    }
  };
  walk(root);
  return results;
};

/**
 * Returns the deepest AST node whose source range contains `offset`.
 * Equivalent to ts-morph's `SourceFile.getDescendantAtPos(offset)`.
 *
 * Each successive match overwrites `deepest`, so after the full walk the
 * last assignment is the most deeply nested node that still covers the
 * cursor position.
 */
const findNodeAtOffset = (root: any, offset: number): any | null => {
  let deepest: any = null;
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    // Skip nodes without range info (e.g. synthetic program wrapper)

    if (!node.type || !node.range) return;
    const [start, end] = node.range;

    if (start <= offset && offset < end) {
      deepest = node;

      for (const key of Object.keys(node)) {
        if (key === "parent" || key === "tokens" || key === "comments")
          continue;
        walk(node[key]);
      }
    }
  };
  walk(root);
  return deepest;
};

// --- Literal helpers ---

const isStringLiteral = (node: any): boolean =>
  node?.type === "Literal" && typeof node.value === "string";

// A no-substitution template literal is a TemplateLiteral with zero
// interpolation expressions, e.g. `hello`.
const isNoSubTemplateLiteral = (node: any): boolean =>
  node?.type === "TemplateLiteral" && node.expressions.length === 0;

const getLiteralText = (node: any): string => {
  if (node?.type === "Literal") return String(node.value);

  if (node?.type === "TemplateLiteral")
    return node.quasis[0]?.value?.cooked ?? "";
  return "";
};

// ---------------------------------------------------------------------------

interface IntlayerOrigin {
  dictionaryKey: string;
  fieldPath: string[];
  moduleSource: string | null;
}

/**
 * Given a cursor position inside a VSCode document, resolves which intlayer
 * dictionary key and field path the hovered expression refers to.
 *
 * Steps:
 *  1. Parse the (script) content of the file into an AST.
 *  2. Find the AST node at the cursor offset.
 *  3. Walk up through property accesses to find the root identifier and the
 *     chain of property names accessed on it (`analyzePropertyChain`).
 *  4. Trace the root identifier back to its declaration to check whether it
 *     came from a `useIntlayer` / `getIntlayer` call.
 *  5. Return the dictionary key, field path, and import source.
 */
export const resolveIntlayerPath = async (
  document: TextDocument,
  position: Position,
): Promise<IntlayerOrigin | null> => {
  try {
    const fileContent = document.getText();
    const extension = extname(document.uri.fsPath).toLowerCase();
    // For .vue / .svelte files, extractScriptContent strips the template/style
    // sections so that only the JS/TS script block is parsed.
    const scriptContent = extractScriptContent(fileContent, extension);

    let ast: any;
    try {
      ast = parseCode(scriptContent);
    } catch {
      // Unparseable file (e.g. syntax error in the editor) — bail silently.
      return null;
    }

    const program = ast.program;
    const parentMap = buildParentMap(program);

    // Convert the VSCode Position to a character offset into scriptContent.
    const offset = document.offsetAt(position);
    const node = findNodeAtOffset(program, offset);

    if (!node) return null;

    // Hovering over a string literal (e.g. inside useIntlayer('key')) is not
    // actionable — we only care about identifiers and property accesses.

    if (isStringLiteral(node)) return null;

    // Step 3 — determine which variable is being accessed and what properties
    // the cursor is on (e.g. `content.title.text` → root=content, path=[title,text]).
    const { rootIdentifier, pathFromRoot } = analyzePropertyChain(
      node,
      parentMap,
    );

    if (!rootIdentifier) return null;

    // Strip the Svelte reactive `$` prefix
    // if present (e.g. `$content`).
    const rawVarName = rootIdentifier.name.replace(/^\$/, "");

    // Build candidate names to handle Vue PascalCase component refs that are
    // imported as camelCase, and kebab-case to camelCase conversions.
    const varNames = [
      rawVarName,
      rawVarName.charAt(0).toLowerCase() + rawVarName.slice(1), // PascalCase → camelCase
      rawVarName.replace(/-([a-z])/g, (_dash: string, letter: string) =>
        letter.toUpperCase(),
      ), // kebab-case → camelCase
    ];

    // Step 4 — find the declaration site of the root identifier.
    let declaration: any = null;

    // First, search VariableDeclarators in the file.
    // This covers both `const content = useIntlayer('key')` and the
    // destructured form `const { title } = useIntlayer('key')`.
    const allVarDecls = findAllOfType(program, "VariableDeclarator");

    for (const varDecl of allVarDecls) {
      const nameNode = varDecl.id;

      if (nameNode.type === "ObjectPattern") {
        // Destructuring: const { title, body } = useIntlayer('key')
        // Find the Property whose binding target matches our variable name.
        const element = nameNode.properties.find(
          (el: any) =>
            el.type === "Property" &&
            el.value?.type === "Identifier" &&
            varNames.includes(el.value.name),
        );

        if (element) {
          declaration = element;
          break;
        }
      } else if (
        nameNode.type === "Identifier" &&
        varNames.includes(nameNode.name)
      ) {
        // Direct assignment: const content = useIntlayer('key')
        declaration = varDecl;
        break;
      }
    }

    // Fallback: check import specifiers.
    // This is less common for useIntlayer but handles edge cases where the
    // variable is re-exported or aliased via an import.

    if (!declaration) {
      for (const stmt of program.body) {
        if (stmt.type !== "ImportDeclaration") continue;
        const namedSpec = stmt.specifiers.find(
          (spec: any) =>
            spec.type === "ImportSpecifier" &&
            varNames.includes(spec.local?.name),
        );

        if (namedSpec) {
          declaration = namedSpec;
          break;
        }
      }
    }

    if (!declaration) return null;

    let dictionaryKey: string | null = null;
    let initialPath: string[] = [];
    let functionName: string | null = null;

    if (
      declaration.type === "Property" &&
      parentMap.get(declaration)?.type === "ObjectPattern"
    ) {
      // Destructured binding element, e.g. `title` in:
      //   const { title } = useIntlayer('key')
      const check = analyzeBindingElement(declaration, parentMap);

      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = check.path; // The destructured key becomes the initial path segment.
        functionName = check.functionName;
      }
    } else if (declaration.type === "VariableDeclarator") {
      // Full assignment, e.g.:
      //   const content = useIntlayer('key')
      const check = analyzeVariableDeclarator(declaration);

      if (check) {
        dictionaryKey = check.dictionaryKey;
        initialPath = []; // Path starts at the root of the dictionary.
        functionName = check.functionName;
      }
    }

    if (dictionaryKey && functionName) {
      // Look up which package the hook was imported from so callers can
      // discriminate between `next-intlayer`, `react-intlayer`, etc.
      const moduleSource = getModuleSource(program, functionName);
      return {
        dictionaryKey,
        // Combine the path from the destructuring site with any further
        // property accesses observed at the cursor position.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Starting from the hovered node, walks upward through property access chains
 * and call expressions to find:
 *  - `rootIdentifier` — the leftmost identifier (the variable being accessed)
 *  - `pathFromRoot`   — the ordered list of property names traversed after it
 *
 * Examples:
 *   Hovering `title` in `content.title`         → root=content, path=[title]
 *   Hovering `desc`  in `content.section.desc`  → root=content, path=[section,desc]
 *   Hovering `title` in `<content.title />`     → root=content, path=[title]
 *   Hovering `content()` (SolidJS signal call)  → root=content, path=[]
 */
const analyzePropertyChain = (
  startNode: any,
  parentMap: Map<any, any>,
): { rootIdentifier: any | null; pathFromRoot: string[] } => {
  let current = startNode;
  const path: string[] = [];

  while (true) {
    const parent = parentMap.get(current);

    if (current.type === "Identifier" || current.type === "JSXIdentifier") {
      // Check whether this identifier sits in the *property* position of a
      // member expression (right of the dot), not the *object* position.
      const isPropertyName =
        (parent?.type === "MemberExpression" &&
          !parent.computed &&
          parent.property === current) ||
        (parent?.type === "JSXMemberExpression" && parent.property === current);

      if (isPropertyName) {
        // Prepend this property name and move left to the object expression.
        path.unshift(current.name);
        current = parent.object;
        continue;
      }
      // The identifier is in the object/root position — stop traversal.
      break;
    }

    if (current.type === "MemberExpression" && !current.computed) {
      // We landed on a MemberExpression node directly (rather than on its
      // Identifier child), e.g. when the cursor is on the `.` dot character.
      path.unshift(current.property.name ?? "");
      current = current.object;
      continue;
    }

    if (current.type === "CallExpression") {
      // Handles SolidJS reactive signals: `content()` — treat the call result
      // as the object and keep walking leftward.
      current = current.callee;
      continue;
    }

    if (current.type === "JSXMemberExpression") {
      // JSX member tags: <content.title /> — same left-walk as MemberExpression.
      path.unshift(current.property.name ?? "");
      current = current.object;
      continue;
    }

    break;
  }

  if (current.type === "Identifier" || current.type === "JSXIdentifier") {
    return { rootIdentifier: current, pathFromRoot: path };
  }

  return { rootIdentifier: null, pathFromRoot: [] };
};

/**
 * Analyzes a destructuring binding element (a `Property` inside an
 * `ObjectPattern`) and walks up to the enclosing `VariableDeclarator` to
 * check whether it was initialised by `useIntlayer` / `getIntlayer`.
 *
 * Example:
 *   const { title } = useIntlayer('homepage')
 *   → property.key.name = 'title', result.path = ['title'], result.dictionaryKey = 'homepage'
 *
 *   const { body: pageBody } = useIntlayer('homepage')
 *   → property.key.name = 'body', result.path = ['body']
 */
const analyzeBindingElement = (
  property: any,
  parentMap: Map<any, any>,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  let path: string[] = [];

  if (property.shorthand || !property.key) {
    // Shorthand: { title } — the key name is the same as the binding name.
    path = [property.key?.name ?? ""];
  } else if (property.key.type === "Identifier") {
    path = [property.key.name];
  } else if (property.key.type === "Literal") {
    // Computed / quoted key: { "my-key": value }
    path = [String(property.key.value)];
  }

  // Walk up: Property → ObjectPattern → VariableDeclarator
  const objectPattern = parentMap.get(property);

  if (objectPattern?.type !== "ObjectPattern") return null;

  const varDecl = parentMap.get(objectPattern);

  if (varDecl?.type !== "VariableDeclarator") return null;

  const result = analyzeVariableDeclarator(varDecl);

  if (result) {
    return { ...result, path: [...result.path, ...path] };
  }
  return null;
};

/**
 * Checks whether a `VariableDeclarator`'s initialiser is a direct or awaited
 * call to `useIntlayer` / `getIntlayer`, and
 * if so extracts the dictionary key.
 *
 * Handles:
 *   const content = useIntlayer('key')
 *   const content = await getIntlayer('key')
 */
const analyzeVariableDeclarator = (
  decl: any,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  const initializer = decl.init;

  if (initializer?.type === "CallExpression") {
    return extractIntlayerInfo(initializer);
  }

  if (initializer?.type === "AwaitExpression") {
    const expr = initializer.argument;

    if (expr?.type === "CallExpression") {
      return extractIntlayerInfo(expr);
    }
  }

  return null;
};

/**
 * Extracts the dictionary key from a `useIntlayer('key')` or
 * `getIntlayer('key')` call expression.
 * Returns `null`
 * if the callee is not one of those functions or
 * if the first
 * argument is not a static string / template literal.
 */
const extractIntlayerInfo = (
  callExpr: any,
): { dictionaryKey: string; functionName: string; path: string[] } | null => {
  const callee = callExpr.callee;

  if (callee?.type !== "Identifier") return null;

  const funcName = callee.name;

  if (funcName !== "useIntlayer" && funcName !== "getIntlayer") return null;

  const args = callExpr.arguments;

  if (args.length > 0) {
    const keyArg = args[0];

    if (isStringLiteral(keyArg) || isNoSubTemplateLiteral(keyArg)) {
      return {
        dictionaryKey: getLiteralText(keyArg),
        functionName: funcName,
        path: [],
      };
    }
  }
  return null;
};

/**
 * Searches the top-level import declarations to find which module exports the
 * given function name, e.g. `useIntlayer` → `'next-intlayer'`.
 * Returns `null`
 * if the function is not imported (e.g. globally available).
 */
const getModuleSource = (program: any, functionName: string): string | null => {
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;

    for (const spec of stmt.specifiers) {
      if (
        spec.type === "ImportSpecifier" &&
        spec.local?.name === functionName
      ) {
        return stmt.source?.value ?? null;
      }
    }
  }
  return null;
};
