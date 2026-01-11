import { extname } from "node:path";
import {
  type Extension,
  type Format,
  getFormatFromExtension,
} from "@intlayer/chokidar";
import { window } from "vscode";
import { generateDictionaryContent } from "../createDictionaryContent";

export const createDictionaryFile = async () => {
  const filePath = window.activeTextEditor?.document.uri.fsPath;

  let format: Format;

  if (filePath) {
    const extension = extname(filePath) as Extension;
    format = getFormatFromExtension(extension);
  } else {
    format = await window
      .showQuickPick(
        [
          { label: "TypeScript (.ts)", value: "ts" },
          { label: "ESM (.js)", value: "esm" },
          { label: "CommonJS (.js)", value: "cjs" },
          { label: "JSON (.json)", value: "json" },
          { label: "JSONC (.jsonc)", value: "jsonc" },
          { label: "JSON5 (.json5)", value: "json5" },
        ],
        { placeHolder: "Select content file format" }
      )
      .then((choice) => choice?.value as Format);
  }

  await generateDictionaryContent(format);
};
