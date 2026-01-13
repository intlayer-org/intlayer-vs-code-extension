import { join } from "node:path";
import { workspace, Uri, Range, RelativePattern } from "vscode";
import { Project, SyntaxKind, Node, type SourceFile } from "ts-morph";
import { getConfiguration } from "@intlayer/config";
import { getConfigurationOptions } from "./getConfiguration";

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

export const findUsagesOfDictionary = async (
  projectDir: string,
  dictionaryKey: string
): Promise<UsageLocation[]> => {
  const configOptions = await getConfigurationOptions(projectDir);
  const config = getConfiguration(configOptions);

  // Search across the project (excluding node_modules)
  const searchPattern = new RelativePattern(
    projectDir,
    "**/*.{ts,tsx,js,jsx,mjs,cjs}"
  );

  const relevantFiles = await workspace.findFiles(
    searchPattern,
    "**/node_modules/**"
  );

  const usageLocations: UsageLocation[] = [];

  for (const fileUri of relevantFiles) {
    try {
      const content = await workspace.fs.readFile(fileUri);
      const text = new TextDecoder("utf-8").decode(content);

      // Fast pre-check
      if (!text.includes(dictionaryKey)) {
        continue;
      }

      const sourceFile = project.createSourceFile(fileUri.fsPath, text, {
        overwrite: true,
      });

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
    if (funcName !== "useIntlayer" && funcName !== "getIntlayer") {
      continue;
    }

    // 2. Check First Argument
    const args = call.getArguments();
    if (args.length === 0) {
      continue;
    }

    const firstArg = args[0];
    let argText = "";
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
      keysUsed.add(key);
      const nStart = sourceFile.getLineAndColumnAtPos(node.getStart());
      const nEnd = sourceFile.getLineAndColumnAtPos(node.getEnd());
      const r = new Range(
        nStart.line - 1,
        nStart.column - 1,
        nEnd.line - 1,
        nEnd.column - 1
      );
      const list = keyLocations.get(key) || [];
      list.push(r);
      keyLocations.set(key, list);
    };

    // 3. Trace Variable
    const varDecl = call.getParentIfKind(SyntaxKind.VariableDeclaration);

    if (!varDecl) {
      keysUsed.add("__EXISTENCE_CHECK__");
      results.push({ range: declarationRange, keysUsed, keyLocations });
      continue;
    }

    const nameNode = varDecl.getNameNode();

    // Pattern A: Destructuring -> const { title } = useIntlayer('app')
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const propName = element.getPropertyNameNode();
        const key = propName
          ? propName.getText()
          : element.getNameNode().getText();

        // The location is the property name in the destructuring
        addLocation(key, propName || element.getNameNode());
      }
    }
    // Pattern B: Variable -> const content = useIntlayer('app')
    else if (Node.isIdentifier(nameNode)) {
      const varName = nameNode.getText();
      const scope = varDecl.getSourceFile();

      const refs = scope
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((id) => id.getText() === varName && id !== nameNode);

      for (const ref of refs) {
        const parent = ref.getParent();

        // 1. content.title
        if (
          Node.isPropertyAccessExpression(parent) &&
          parent.getExpression() === ref
        ) {
          const key = parent.getName();
          addLocation(key, parent.getNameNode());
        }
        // 2. content['title']
        else if (
          Node.isElementAccessExpression(parent) &&
          parent.getExpression() === ref
        ) {
          const arg = parent.getArgumentExpression();
          if (
            arg &&
            (Node.isStringLiteral(arg) ||
              Node.isNoSubstitutionTemplateLiteral(arg))
          ) {
            const key = arg.getLiteralText();
            addLocation(key, arg);
          }
        }
        // 3. Spread / Unknown
        else {
          keysUsed.add("__ALL__");
        }
      }
    }

    results.push({ range: declarationRange, keysUsed, keyLocations });
  }

  return results;
};
