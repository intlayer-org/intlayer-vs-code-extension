import { getConfiguration } from "@intlayer/config";
import { existsSync, writeFileSync } from "fs";
import { basename, dirname, join, extname } from "path";
import {
  window,
  workspace,
  Position,
  Range,
  Selection,
  TextEditorRevealType,
} from "vscode";
import { findProjectRoot } from "./findProjectRoot";

/**
 * Attempt to detect an exported React component name in the file text.
 * Looks for patterns like:
 *   - export const MyComponent = ...
 *   - export function MyComponent(...)
 *   - export default function MyComponent(...)
 */
const detectExportedComponentName = (fileText: string): string | null => {
  // Added regexes for default ESM, default CJS, and named exports
  const defaultEsmFnRegex = /export\s+default\s+function\s+(\w+)/;
  const defaultEsmVarRegex = /export\s+default\s+(\w+)/;
  const cjsDefaultRegex = /module\.exports\s*=\s*(\w+)/;
  const cjsDefaultVarRegex = /exports\.default\s*=\s*(\w+)/;
  const namedExportRegex = /export\s+(?:const|function)\s+(\w+)/g;

  // 1) Check for default ESM function or variable
  const defaultEsmFnMatch = fileText.match(defaultEsmFnRegex);
  if (defaultEsmFnMatch) {
    return defaultEsmFnMatch[1];
  }

  const defaultEsmVarMatch = fileText.match(defaultEsmVarRegex);
  if (defaultEsmVarMatch) {
    return defaultEsmVarMatch[1];
  }

  // 2) Check for default CJS
  const cjsDefaultMatch =
    fileText.match(cjsDefaultRegex) || fileText.match(cjsDefaultVarRegex);
  if (cjsDefaultMatch) {
    return cjsDefaultMatch[1];
  }

  // 3) Otherwise, look for capitalized named exports
  let match;
  while ((match = namedExportRegex.exec(fileText)) !== null) {
    if (/^[A-Z]/.test(match[1])) {
      return match[1];
    }
  }

  // If we can’t find it, return null
  return null;
};

const getContentPosition = (content: string): Position => {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const column = lines[i].indexOf("content: {}");
    if (column !== -1) {
      return new Position(i, column + "content: {".length);
    }
  }
  return new Position(0, 0);
};

export const generateDictionaryContent = async (
  format: "ts" | "esm" | "cjs" | "json"
) => {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage("No active text editor");
    return;
  }

  const projectDir = findProjectRoot();

  const currentFilePath = editor.document.uri.fsPath;
  const currentFileName = basename(currentFilePath); // e.g. 'MyComponent.tsx'
  const currentDir = dirname(currentFilePath);

  const configuration = getConfiguration({
    baseDir: projectDir,
  });

  // Grab the entire file text to parse for an exported component name
  const fileText = editor.document.getText();

  // Attempt to detect a React component name if it’s exported
  const detectedExportName = detectExportedComponentName(fileText);

  // 1) Derive base name (without extension) from something like 'MyComponent.tsx' => 'MyComponent'
  //    or from 'index.jsx' => 'index'
  const { baseName: fileBaseName } = parseFileName(currentFileName);

  // If we found a name from an exported component, use that instead
  const baseName = detectedExportName ?? fileBaseName;

  // 2) Determine if it’s TS or JS-based to pick the correct extension for the content file
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

  // 3) Build the target dictionary file name
  //    e.g. MyComponent => myComponent.content.ts
  //         index => index.content.ts
  const targetFileName =
    toLowerCamelCase(fileBaseName) +
    (configuration.content.fileExtensions[0] ?? ".content.ts").replace(
      ".ts",
      contentFileExtension
    );
  const targetPath = join(currentDir, targetFileName);

  // 4) Build the variable name and dictionary key
  let variableName: string;
  let dictionaryKey: string;

  // If can't parse or is empty, use fallback
  if (!baseName) {
    variableName = "content";
    dictionaryKey = "";
  } else {
    // If the file is "index"
    if (baseName.toLowerCase() === "index") {
      variableName = "indexContent";
      dictionaryKey = "index";
    } else {
      // Normal case
      variableName = toLowerCamelCase(baseName) + "Content";
      dictionaryKey = toKebabCase(baseName);
    }
  }

  // 5) Create the actual content
  const fileData = createDictionaryContent(format, variableName, dictionaryKey);

  // 6) Write the file if not existing already (or ask to overwrite)
  if (existsSync(targetPath)) {
    const overwrite = await window.showWarningMessage(
      `${basename(targetPath)} already exists. Overwrite?`,
      "Yes",
      "No"
    );
    if (overwrite !== "Yes") {
      return;
    }
  }

  writeFileSync(targetPath, fileData, "utf8");

  window.showInformationMessage(`Dictionary created: ${targetFileName}`);

  // Open the newly created file in VS Code
  const document = await workspace.openTextDocument(targetPath);
  const newEditor = await window.showTextDocument(document); // Capture the newEditor instance

  const position = getContentPosition(fileData);
  newEditor.selection = new Selection(position, position);
  newEditor.revealRange(
    new Range(position, position),
    TextEditorRevealType.InCenter
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
 */
const toLowerCamelCase = (str: string): string => {
  if (!str) {
    return "";
  }
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

const getTSDictionaryContent = (
  variableName: string,
  dictionaryKey: string
): string => `import { type Dictionary } from 'intlayer';

const ${variableName} = {
  key: '${dictionaryKey}',
  content: {},
} satisfies Dictionary;

export default ${variableName};
`;

const getESMDictionaryContent = (
  variableName: string,
  dictionaryKey: string
): string => `import { } from 'intlayer';

/** @type {import('intlayer').Dictionary} */
const ${variableName} = {
  key: '${dictionaryKey}',
  content: {},
};

export default ${variableName};
`;

const getCommonDictionaryContent = (
  variableName: string,
  dictionaryKey: string
): string => `const { } = require('intlayer');

/** @type {import('intlayer').Dictionary} */
const ${variableName} = {
  key: '${dictionaryKey}',
  content: {},
};

export default ${variableName};
`;

const getJSONDictionaryContent = (dictionaryKey: string): string => `{
  "$schema": "https://intlayer.org/schema.json",
  "key": "${dictionaryKey}",
  "content": {}
}
`;

/**
 * Returns the file content for the dictionary file, e.g.:
 *
 *   const myNewComponentContent = {
 *     key: 'my-new-component',
 *     content: {},
 *   } satisfies Dictionary;
 *
 *   export default myNewComponentContent;
 */
const createDictionaryContent = (
  extension: "ts" | "esm" | "cjs" | "json",
  variableName: string,
  dictionaryKey: string
): string => {
  switch (extension) {
    case "ts":
      return getTSDictionaryContent(variableName, dictionaryKey);
    case "esm":
      return getESMDictionaryContent(variableName, dictionaryKey);
    case "cjs":
      return getCommonDictionaryContent(variableName, dictionaryKey);
    case "json":
      return getJSONDictionaryContent(dictionaryKey);
    default:
      return "";
  }
};
