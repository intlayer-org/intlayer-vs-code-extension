import { window, workspace } from "vscode";
import { listMissingTranslations } from "@intlayer/cli";
import { listDictionaries, loadDictionaries } from "@intlayer/chokidar";
import { findProjectRoot } from "../utils/findProjectRoot";
import { getConfiguration } from "@intlayer/config";
import { createRequire } from "module";
import { join } from "path";
import type { Dictionary } from "@intlayer/core";
import { getConfigurationOptions } from "../utils/getConfiguration";
import { prefix } from "../utils/logFunctions";

const groupDictionariesByKey = (
  dictionaries: Dictionary[]
): Record<string, Dictionary[]> =>
  dictionaries.reduce(
    (acc, dictionary) => {
      const key = dictionary.key;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(dictionary);
      return acc;
    },
    {} as Record<string, Dictionary[]>
  );

// Helper to pretty-print details into a temporary editor document
const writeMissingReport = async (
  result: Awaited<ReturnType<typeof listMissingTranslations>>
) => {
  const lines: string[] = [];
  lines.push("## Intlayer — Missing Translations Report");
  lines.push("");
  lines.push(
    `- Missing locales (any): ${result.missingLocales.length ? result.missingLocales.join(", ") : "—"}`
  );
  lines.push(
    `- Missing required locales: ${result.missingRequiredLocales.length ? result.missingRequiredLocales.join(", ") : "—"}`
  );
  lines.push("");

  if (!result.missingTranslations.length) {
    lines.push("✔ No missing translation keys found.");
  } else {
    lines.push(
      `⚠ ${result.missingTranslations.length} missing translation key(s):`
    );
    lines.push("");
    for (const item of result.missingTranslations) {
      const filePath = item.filePath ?? "(unknown file)";
      lines.push(`### Key: ${String(item.key)}`);
      lines.push(`- File: ${filePath}`);
      lines.push(`- Missing locales: ${item.locales.join(", ")}`);
      lines.push("");
    }
  }

  const doc = await workspace.openTextDocument({
    language: "markdown",
    content: lines.join("\n"),
  });
  await window.showTextDocument(doc, { preview: false });
};

export const testCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage(`${prefix}Could not find intlayer project root.`);
    return;
  }

  try {
    const configOptions = await getConfigurationOptions(projectDir);
    const configuration = getConfiguration(configOptions);
    const dictionariesPath = listDictionaries(configuration);
    const projectRequire = createRequire(join(projectDir, "package.json"));

    const dictionaries = await loadDictionaries(
      dictionariesPath,
      configuration,
      projectRequire
    );

    if (!dictionaries.localDictionaries.length) {
      window.showWarningMessage(`${prefix}No dictionaries available.`);
      return;
    }

    const dictionaryRecords = groupDictionariesByKey(
      dictionaries.localDictionaries
    );

    const result = listMissingTranslations(dictionaryRecords, configOptions);

    const hasIssues =
      result.missingTranslations.length > 0 || result.missingLocales.length > 0;

    if (hasIssues) {
      await writeMissingReport(result);
    } else {
      window.showInformationMessage(`${prefix}No missing translations found.`);
    }
  } catch (error) {
    window.showErrorMessage(
      `${prefix} test failed: ${(error as Error).message}`
    );
  }
};
