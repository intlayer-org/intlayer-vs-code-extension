import { window } from "vscode";
import { listMissingTranslations } from "@intlayer/cli";
import { listDictionaries, loadDictionaries } from "@intlayer/chokidar";
import { findProjectRoot } from "./findProjectRoot";
import { getConfiguration } from "@intlayer/config";
import { createRequire } from "module";
import path from "path";
import { Dictionary } from "intlayer";

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

// Helper to pretty-print details into the output channel
const writeMissingReport = (
  result: Awaited<ReturnType<typeof listMissingTranslations>>
) => {
  const out = window.createOutputChannel("Intlayer");
  out.clear();
  out.appendLine("=====================================");
  out.appendLine("Intlayer — Missing Translations Report");
  out.appendLine("=====================================");
  out.appendLine("");
  out.appendLine(
    `Missing locales (any): ${result.missingLocales.length ? result.missingLocales.join(", ") : "—"}`
  );
  out.appendLine(
    `Missing required locales: ${result.missingRequiredLocales.length ? result.missingRequiredLocales.join(", ") : "—"}`
  );
  out.appendLine("");

  if (!result.missingTranslations.length) {
    out.appendLine("✔ No missing translation keys found.");
  } else {
    out.appendLine(
      `⚠ ${result.missingTranslations.length} missing translation key(s):\n`
    );
    for (const item of result.missingTranslations) {
      const path = item.filePath ?? "(unknown file)";
      out.appendLine(`• Key: ${String(item.key)}`);
      out.appendLine(`  File: ${path}`);
      out.appendLine(`  Missing locales: ${item.locales.join(", ")}`);
      out.appendLine("");
    }
  }

  out.show(true);
};

export const testCommand = async () => {
  const projectDir = findProjectRoot();

  if (!projectDir) {
    window.showErrorMessage("Could not find intlayer project root.");
    return;
  }

  try {
    const configuration = getConfiguration({ baseDir: projectDir });
    const dictionariesPath = listDictionaries(configuration);
    const projectRequire = createRequire(path.join(projectDir, "package.json"));

    const dictionaries = await loadDictionaries(
      dictionariesPath,
      configuration,
      projectRequire
    );

    if (!dictionaries.localDictionaries.length) {
      window.showWarningMessage("No dictionaries available.");
      return;
    }

    const dictionaryRecords = groupDictionariesByKey(
      dictionaries.localDictionaries
    );

    const result = listMissingTranslations(dictionaryRecords, {
      baseDir: projectDir,
    });

    const hasIssues =
      result.missingTranslations.length > 0 || result.missingLocales.length > 0;

    if (hasIssues) {
      writeMissingReport(result);
    } else {
      window.showInformationMessage("No missing translations found.");
    }
  } catch (error) {
    window.showErrorMessage(
      `Intlayer test failed: ${(error as Error).message}`
    );
  }
};
