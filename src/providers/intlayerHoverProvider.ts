import { join, dirname } from "node:path";
import { Hover, type HoverProvider, MarkdownString, Uri } from "vscode";
import { findProjectRoot } from "../utils/findProjectRoot";
import { resolveIntlayerPath } from "../utils/intlayerPathResolver";
import { getCachedConfig, getCachedDictionary } from "../utils/intlayerCache";

export const intlayerHoverProvider: HoverProvider = {
  provideHover: async (document, position) => {
    // 1. Resolve Path (Fast AST check)
    const origin = await resolveIntlayerPath(document, position);
    if (!origin) {
      return null;
    }

    const { dictionaryKey, fieldPath, moduleSource } = origin;
    const cleanPath = [...fieldPath];
    const lastKey = cleanPath[cleanPath.length - 1];

    // Check if accessing properties specific to frameworks
    const isAccessor = lastKey === "value" || lastKey === "raw";

    if (isAccessor) {
      cleanPath.pop();
    }

    // 2. Find Root
    const fileDir = dirname(document.uri.fsPath);
    const projectDir = findProjectRoot(fileDir);
    if (!projectDir) {
      return null;
    }

    // 3. Get Config (OPTIMIZED: Uses Cache)
    const config = await getCachedConfig(projectDir);

    const dictionaryJsonPath = join(
      config.content.unmergedDictionariesDir,
      `${dictionaryKey}.json`
    );

    // 4. Get Dictionary (OPTIMIZED: Async & Cached)
    const dictionaries = await getCachedDictionary(dictionaryJsonPath);

    if (!dictionaries) {
      return null;
    }

    // --- DETERMINE TYPE (Pre-calculation) ---
    let displayType = "unknown";

    // Scan dictionaries to find the first valid node to determine the type
    for (const dict of dictionaries) {
      if (dict.location === "remote") {
        continue;
      }

      const targetNode = traverseContent(dict.content, cleanPath);
      if (targetNode) {
        if (
          typeof targetNode === "object" &&
          targetNode.nodeType === "translation" &&
          targetNode.translation
        ) {
          const translationValues = Object.values(targetNode.translation);
          const primitiveType =
            translationValues.length > 0
              ? typeof translationValues[0]
              : "unknown";

          // Core 'intlayer' package returns content directly
          if (moduleSource === "intlayer") {
            displayType = primitiveType;
          }
          // Framework wrappers return Nodes, unless we accessed .value/.raw
          else {
            displayType = isAccessor ? primitiveType : "IntlayerNode";
          }
        } else if (typeof targetNode === "object") {
          displayType = "Object";
        } else {
          displayType = typeof targetNode;
        }
        // Stop once we find the first valid definition to determine the type
        break;
      }
    }

    const hoverTexts: MarkdownString[] = [];

    // --- BUILD HEADER ---
    const header = new MarkdownString();
    header.appendMarkdown(`### Intlayer: \`${dictionaryKey}\``);
    header.appendMarkdown(`\n\n**Path**: \`${cleanPath.join(".") || "root"}\``);
    // Type is now added to the header section
    header.appendMarkdown(`\n**Type**: \`${displayType}\``);
    hoverTexts.push(header);

    // --- BUILD CONTENT BODY ---
    for (const dict of dictionaries) {
      if (dict.location === "remote") {
        const url = `${config.editor.cmsURL}/dictionary/${dictionaryKey}`;
        const md = new MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(
          `\n---\n### Remote Dictionary\n[Open Dashboard](${url})`
        );
        hoverTexts.push(md);
        continue;
      }

      const targetNode = traverseContent(dict.content, cleanPath);

      if (targetNode) {
        const md = new MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        if (dict.filePath) {
          const fileUri = Uri.file(join(projectDir, dict.filePath));
          md.appendMarkdown(
            `**File Location:**\n[${dict.filePath}](${fileUri})`
          );
        } else {
          md.appendMarkdown(`### Local Content`);
        }
        md.appendMarkdown(`\n\n---\n\n`);

        if (
          typeof targetNode === "object" &&
          targetNode.nodeType === "translation" &&
          targetNode.translation
        ) {
          md.appendMarkdown(`| Locale | Translation |\n| :--- | :--- |\n`);
          for (const [locale, val] of Object.entries(targetNode.translation)) {
            md.appendMarkdown(`| **${locale}** | ${val} |\n`);
          }
        } else if (typeof targetNode === "object") {
          md.appendCodeblock(JSON.stringify(targetNode, null, 2), "json");
        } else {
          md.appendMarkdown(`**Value**: ${targetNode}`);
        }
        hoverTexts.push(md);
      }
    }

    return new Hover(hoverTexts);
  },
};

const traverseContent = (content: any, path: string[]) => {
  let current = content;
  for (const key of path) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }
  return current;
};
