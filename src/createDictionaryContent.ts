import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  getContentDeclarationFileTemplate,
  detectExportedComponentName,
  detectFormatCommand,
} from "@intlayer/chokidar";
import { getConfiguration } from "@intlayer/config";
import {
  Position,
  Range,
  Selection,
  TextEditorRevealType,
  window,
  workspace,
} from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getConfigurationOptions } from "./utils/getConfiguration";

const getContentPosition = (content: string): Position => {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // Match content key in various styles: content: { ... }, "content": { ... }, 'content': { ... }
    const patterns = [
      /content\s*:\s*\{/,
      /"content"\s*:\s*\{/,
      /'content'\s*:\s*\{/,
    ];
    for (const pattern of patterns) {
      const match = lines[i].match(pattern);
      console.log(match);
      if (match && match.index !== undefined) {
        return new Position(i, match.index + match[0].length);
      }
    }
  }
  return new Position(0, 0);
};

export const generateDictionaryContent = async (
  format: "ts" | "esm" | "cjs" | "json" | "jsonc" | "json5",
) => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage("No active text editor");
    return;
  }

  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`Could not find intlayer project root.`);
    return;
  }

  const currentFilePath = editor.document.uri.fsPath;
  const currentFileName = basename(currentFilePath); // e.g. 'MyComponent.tsx'
  const currentDir = dirname(currentFilePath);

  const configOptions = await getConfigurationOptions(projectDir);
  const configuration = getConfiguration(configOptions);

  // Grab the entire file text to parse for an exported component name
  const fileText = editor.document.getText();

  // Attempt to detect a React component name if it’s exported
  const detectedExportName = detectExportedComponentName(fileText);

  // Derive base name (without extension) from something like 'MyComponent.tsx' => 'MyComponent'
  //    or from 'index.jsx' => 'index'
  const { baseName: fileBaseName } = parseFileName(currentFileName);

  // If we found a name from an exported component, use that instead
  const baseName = detectedExportName ?? fileBaseName;

  // Determine if it’s TS or JS-based to pick the correct extension for the content file
  let contentFileExtension = ".ts";
  switch (format) {
    case "json":
      contentFileExtension = ".json";
      break;
    case "cjs":
      contentFileExtension = ".js";
      break;
    case "esm":
      contentFileExtension = ".js";
      break;
  }

  // Build the target dictionary file name
  //    e.g. MyComponent => myComponent.content.ts
  //         index => index.content.ts

  const pickedFileExtension = configuration.content.fileExtensions.find(
    (extension) => extension.includes(contentFileExtension),
  );
  const targetFileName =
    toLowerCamelCase(fileBaseName) +
    (
      pickedFileExtension ??
      configuration.content.fileExtensions[0] ??
      ".content.ts"
    ).replace(".ts", contentFileExtension);
  const targetPath = join(currentDir, targetFileName);

  // Build the dictionary key
  let dictionaryKey: string;

  // If can't parse or is empty, use fallback
  if (!baseName) {
    dictionaryKey = "";
  } else if (baseName.toLowerCase() === "index") {
    dictionaryKey = "index";
  } else {
    dictionaryKey = toKebabCase(baseName);
  }

  // Create the actual content using shared template logic
  const fileData = await getContentDeclarationFileTemplate(
    dictionaryKey,
    format,
    // Filter out undefined values
    Object.fromEntries(
      Object.entries(configuration.dictionary ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  );

  // Write the file if not existing already (or ask to overwrite)
  if (existsSync(targetPath)) {
    const overwrite = await window.showWarningMessage(
      `${basename(targetPath)} already exists. Overwrite?`,
      "Yes",
      "No",
    );
    if (overwrite !== "Yes") {
      return;
    }
  }

  writeFileSync(targetPath, fileData, "utf8");

  try {
    if (configOptions.require) {
      const formatCommand = detectFormatCommand(
        configuration,
        configOptions.require,
      );

      if (formatCommand) {
        execSync(formatCommand.replace("{{file}}", targetPath), {
          stdio: "inherit",
          cwd: configuration.content.baseDir,
        });
      }
    }
  } catch (error) {
    console.error(error);
  }

  window.showInformationMessage(`Dictionary created: ${targetFileName}`);

  // Open the newly created file in VS Code
  const document = await workspace.openTextDocument(targetPath);
  const newEditor = await window.showTextDocument(document); // Capture the newEditor instance

  const position = getContentPosition(fileData);
  newEditor.selection = new Selection(position, position);
  newEditor.revealRange(
    new Range(position, position),
    TextEditorRevealType.InCenter,
  );
};

/**
 * Attempt to parse a file name like "MyComponent.tsx"
 * into { baseName: "MyComponent", ext: ".tsx" }.
 *
 * If we can't parse anything, returns empty baseName & extension.
 */
const parseFileName = (fileName: string): { baseName: string; ext: string } => {
  const ext = extname(fileName); // => .tsx or .jsx or .ts, etc.
  const baseName = basename(fileName, ext); // => MyComponent (if name is MyComponent.tsx)
  return { baseName, ext };
};

/**
 * Convert a string to lowerCamelCase
 * e.g. "MyComponent" => "myComponent"
 * e.g. "auth-middleware" => "authMiddleware"
 */
const toLowerCamelCase = (str: string): string => {
  if (!str) {
    return "";
  }

  // Handle kebab-case: "auth-middleware" => "authMiddleware"
  if (str.includes("-")) {
    return str
      .split("-")
      .map((word, index) => {
        if (index === 0) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join("");
  }

  // Handle PascalCase: "MyComponent" => "myComponent"
  return str.charAt(0).toLowerCase() + str.slice(1);
};

/**
 * Convert a string to kebab-case
 * e.g. "MyNewComponent" => "my-new-component"
 */
const toKebabCase = (str: string): string => {
  // Split on transition from lower->upper: "MyNewComponent" => ["My", "New", "Component"]
  // Then lowercase each chunk and join by "-"
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
};

// Local template helpers removed in favor of getContentDeclarationFileTemplate from @intlayer/chokidar
