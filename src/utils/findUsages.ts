import { extname, join } from 'node:path';
import { getConfiguration } from '@intlayer/config';
import { Node, Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { Range, RelativePattern, type Uri, workspace } from 'vscode';
import { extractScriptContent } from './extractScript';
import { getConfigurationOptions } from './getConfiguration';

// Reuse project instance
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: { allowJs: true, jsx: 1 },
});

export interface UsageLocation {
  uri: Uri;
  range: Range; // The main 'useIntlayer' declaration range (fallback)
  keysUsed: Set<string>; // Set of all keys used in this file
  keyLocations: Map<string, Range[]>; // Specific ranges for each key access
}

const extractScriptContentWithAngular = (text: string, extension: string) => {
  let processedText = extractScriptContent(text, extension);

  // Angular: Extract template content
  if (extension === '.ts' && text.includes('@Component')) {
    const templateRegex = /template\s*:\s*(["'`])([\s\S]*?)\1/g;

    processedText = processedText.replace(
      templateRegex,
      (match, quote, content) => {
        const expressions: string[] = [];
        // Sanitize and push expression
        const sanitize = (e: string) => {
          let s = e;
          s = s.replace(/;/g, ',');
          s = s.replace(/\s+as\s+/g, ',');
          s = s.replace(/\b\w+\s+of\s+/g, '');
          s = s.replace(/\btrack\s+/g, '');
          s = s.replace(/\blet\s+/g, '');
          return s.trim();
        };

        // 1. Interpolations {{ ... }}
        const interpolationRegex = /{{([\s\S]*?)}}/g;
        const interpolationMatches = content.matchAll(interpolationRegex);
        for (const match of interpolationMatches) {
          expressions.push(sanitize(match[1]));
        }

        // 2. Bindings [prop]="..." or bind-prop="..."
        // We match value inside quotes
        const bindingRegex = /(?:\[.*?\]|bind-.*?)\s*=\s*(["'])(.*?)\1/g;
        const bindingMatches = content.matchAll(bindingRegex);
        for (const match of bindingMatches) {
          expressions.push(sanitize(match[2]));
        }

        // 3. Structural Directives *ngIf="..."
        const structRegex = /\*\w+\s*=\s*(["'])(.*?)\1/g;
        const structMatches = content.matchAll(structRegex);
        for (const match of structMatches) {
          expressions.push(sanitize(match[2]));
        }

        // 4. Control Flow @if(...), @for(...), @switch(...)
        // Match content inside parentheses
        const controlFlowRegex = /@\w+\s*\((.*?)\)/g;
        const controlFlowMatches = content.matchAll(controlFlowRegex);
        for (const match of controlFlowMatches) {
          expressions.push(sanitize(match[1]));
        }

        // Combine all expressions into an array
        // We join them with commas.
        // We wrap in [ ... ] to form a valid array literal
        const combined = `[${expressions.join(', ')}]`;

        return `template: ${combined}`;
      }
    );
  }

  return processedText;
};

export const findUsagesOfDictionary = async (
  projectDir: string,
  dictionaryKey: string
): Promise<UsageLocation[]> => {
  const configOptions = await getConfigurationOptions(projectDir);
  const config = getConfiguration(configOptions);

  // Search across the project (excluding node_modules)
  const searchPattern = new RelativePattern(
    projectDir,
    '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}'
  );

  const relevantFiles = await workspace.findFiles(
    searchPattern,
    '**/node_modules/**'
  );

  const usageLocations: UsageLocation[] = [];

  // Concurrency Limit to prevent EMFILE and UI blocking
  const CONCURRENCY_LIMIT = 10;
  const chunks = [];
  for (let i = 0; i < relevantFiles.length; i += CONCURRENCY_LIMIT) {
    chunks.push(relevantFiles.slice(i, i + CONCURRENCY_LIMIT));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (fileUri) => {
        try {
          const content = await workspace.fs.readFile(fileUri);
          const text = new TextDecoder('utf-8').decode(content);

          // Fast pre-check
          if (!text.includes(dictionaryKey)) {
            return;
          }

          const extension = extname(fileUri.fsPath).toLowerCase();
          const scriptContent = extractScriptContentWithAngular(
            text,
            extension
          );
          const fileName =
            fileUri.fsPath +
            (extension === '.vue' || extension === '.svelte' ? '.tsx' : '');

          // Synchronous part - protect with try-catch and potential yield if needed
          // But for 10 files it should be fine.
          const existingFile = project.getSourceFile(fileName);
          if (existingFile) {
            project.removeSourceFile(existingFile);
          }

          const sourceFile = project.createSourceFile(fileName, scriptContent);

          const fileUsages = analyzeFileForUsages(sourceFile, dictionaryKey);

          if (fileUsages.length > 0) {
            const { keys, locations } = mergeUsageData(fileUsages);

            usageLocations.push({
              uri: fileUri,
              range: fileUsages[0].range, // Default to first declaration for file-level
              keysUsed: keys,
              keyLocations: locations,
            });
          }
        } catch (e) {
          console.error(`Error parsing ${fileUri.fsPath}`, e);
        }
      })
    );
  }

  return usageLocations;
};

const mergeUsageData = (
  usages: { keysUsed: Set<string>; keyLocations: Map<string, Range[]> }[]
) => {
  const keys = new Set<string>();
  const locations = new Map<string, Range[]>();

  usages.forEach((u) => {
    // Merge Keys
    u.keysUsed.forEach((k) => {
      keys.add(k);
    });

    // Merge Locations
    u.keyLocations.forEach((ranges, key) => {
      const existing = locations.get(key) || [];
      locations.set(key, [...existing, ...ranges]);
    });
  });

  return { keys, locations };
};

const analyzeFileForUsages = (sourceFile: SourceFile, targetKey: string) => {
  const results: {
    range: Range;
    keysUsed: Set<string>;
    keyLocations: Map<string, Range[]>;
  }[] = [];

  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    // 1. Check Function Name
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr)) {
      continue;
    }
    const funcName = expr.getText();
    if (funcName !== 'useIntlayer' && funcName !== 'getIntlayer') {
      continue;
    }

    // 2. Check First Argument
    const args = call.getArguments();
    if (args.length === 0) {
      continue;
    }

    const firstArg = args[0];
    let argText = '';
    if (
      Node.isStringLiteral(firstArg) ||
      Node.isNoSubstitutionTemplateLiteral(firstArg)
    ) {
      argText = firstArg.getLiteralText();
    }

    if (argText !== targetKey) {
      continue;
    }

    // --- FOUND USAGE ---
    const keysUsed = new Set<string>();
    const keyLocations = new Map<string, Range[]>();

    const start = sourceFile.getLineAndColumnAtPos(call.getStart());
    const end = sourceFile.getLineAndColumnAtPos(call.getEnd());
    const declarationRange = new Range(
      start.line - 1,
      start.column - 1,
      end.line - 1,
      end.column - 1
    );

    // Helper to add location
    const addLocation = (key: string, node: Node) => {
      // --- Clean Key ---
      // remove .value or .raw at the end if present
      const cleanKey = key.replace(/\.(value|raw)$/, '');

      // Add the full key
      keysUsed.add(cleanKey);

      // Add all parent prefixes (e.g., "a.b.c" -> "a", "a.b")
      const parts = cleanKey.split('.');
      for (let i = 1; i < parts.length; i++) {
        keysUsed.add(parts.slice(0, i).join('.'));
      }

      const nStart = sourceFile.getLineAndColumnAtPos(node.getStart());
      const nEnd = sourceFile.getLineAndColumnAtPos(node.getEnd());
      const r = new Range(
        nStart.line - 1,
        nStart.column - 1,
        nEnd.line - 1,
        nEnd.column - 1
      );
      const list = keyLocations.get(cleanKey) || [];
      list.push(r);
      keyLocations.set(cleanKey, list);
    };

    const traceUsages = (varName: string, prefix = '') => {
      const scope = sourceFile;
      const refs = scope
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((id) => {
          const idText = id.getText();
          // Support both direct variable access and Svelte's '$' store prefix
          if (idText !== varName && idText !== `$${varName}`) {
            return false;
          }

          // Avoid declaration itself
          const parent = id.getParent();
          if (
            Node.isVariableDeclaration(parent) ||
            Node.isBindingElement(parent) ||
            Node.isPropertyDeclaration(parent)
          ) {
            return parent.getNameNode() === id ? false : true;
          }

          return true;
        });

      for (const ref of refs) {
        let current: Node = ref;
        const path: string[] = [];

        while (true) {
          const parent = current.getParent();
          if (
            Node.isPropertyAccessExpression(parent) &&
            parent.getExpression() === current
          ) {
            path.push(parent.getName());
            current = parent;
          } else if (
            Node.isElementAccessExpression(parent) &&
            parent.getExpression() === current
          ) {
            const arg = parent.getArgumentExpression();
            if (
              arg &&
              (Node.isStringLiteral(arg) ||
                Node.isNoSubstitutionTemplateLiteral(arg))
            ) {
              path.push(arg.getLiteralText());
              current = parent;
            } else {
              // Non-literal access, mark as ALL used for this branch
              keysUsed.add(prefix ? `${prefix}.__ALL__` : '__ALL__');
              break;
            }
          } else if (
            Node.isCallExpression(parent) &&
            parent.getExpression() === current
          ) {
            // Function call: content()
            // Treat the call result as the object.
            current = parent;
          } else {
            break;
          }
        }

        if (path.length > 0) {
          const fullKey = prefix
            ? `${prefix}.${path.join('.')}`
            : path.join('.');
          addLocation(fullKey, current);
        } else {
          // Used without property access (e.g. passed to function)
          // Exception: If current is a CallExpression, it means we called it but didn't access properties.
          // e.g. content()
          // This should be treated as __ALL__ unless we assume content() returns the object.
          // If content() returns the object, and we stopped here, it means we didn't access properties of the returned object.
          // So it IS __ALL__.
          keysUsed.add(prefix ? `${prefix}.__ALL__` : '__ALL__');
        }
      }
    };

    // 3. Trace Variable
    const varDecl = call.getParentIfKind(SyntaxKind.VariableDeclaration);
    const propDecl = call.getParentIfKind(SyntaxKind.PropertyDeclaration);

    if (!varDecl && !propDecl) {
      keysUsed.add('__EXISTENCE_CHECK__');
      results.push({ range: declarationRange, keysUsed, keyLocations });
      continue;
    }

    if (varDecl) {
      const nameNode = varDecl.getNameNode();

      // Pattern A: Destructuring -> const { textArea } = useIntlayer('app')
      if (Node.isObjectBindingPattern(nameNode)) {
        for (const element of nameNode.getElements()) {
          const propName = element.getPropertyNameNode();
          const key = propName
            ? propName.getText()
            : element.getNameNode().getText();

          const varName = element.getNameNode().getText();

          // Mark the key as used (destructuring site)
          addLocation(key, propName || element.getNameNode());

          // Trace usages of the destructured variable
          traceUsages(varName, key);
        }
      }
      // Pattern B: Variable -> const content = useIntlayer('app')
      else if (Node.isIdentifier(nameNode)) {
        const varName = nameNode.getText();
        traceUsages(varName);
      }
    } else if (propDecl) {
      // Pattern C: Class Property -> content = useIntlayer('app')
      const nameNode = propDecl.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        const varName = nameNode.getText();
        traceUsages(varName);
      }
    }

    results.push({ range: declarationRange, keysUsed, keyLocations });
  }

  return results;
};
