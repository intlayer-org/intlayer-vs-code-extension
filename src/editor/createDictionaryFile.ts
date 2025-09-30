import { window } from "vscode";
import { generateDictionaryContent } from "../createDictionaryContent";
import { extname } from "path";
import { getFormatFromExtension, Extension, Format } from "@intlayer/chokidar";

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
        ],
        { placeHolder: "Select content file format" }
      )
      .then((choice) => choice?.value as Format);
  }

  await generateDictionaryContent(format);
};
