import { dirname, extname, join } from 'node:path';
import { DEFAULT_LOCALE } from '@intlayer/config/defaultValues';
import {
  collectCallerBindings,
  collectMessageUsages,
} from '@intlayer/lsp/utils';
import {
  type DecorationOptions,
  type Disposable,
  Range,
  type TextEditor,
  window,
  workspace,
} from 'vscode';
import { extractScriptContent } from '../utils/extractScript';
import { findProjectRoot } from '../utils/findProjectRoot';
import { getCachedConfig, getCachedDictionary } from '../utils/intlayerCache';
import { getValueFromPath } from '../utils/intlayerValueResolver';

// Configuration
const DEBOUNCE_DELAY = 500;
const TRUNCATE_LENGTH = 60;

// Built unmerged dictionaries — the source the previews below are read from.
const DICTIONARY_OUTPUT_GLOB = "**/.intlayer/unmerged_dictionary/*.json";

// Decoration Style: Appears at the end of the line (Translation Preview)
const translationDecorationType = window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 1ch',
    color: 'rgba(128, 128, 128, 0.3)',
    fontStyle: 'italic',
  },
  rangeBehavior: 1, // ClosedOpen
});

export const intlayerDecorationProvider = (): Disposable[] => {
  let activeEditor = window.activeTextEditor;
  let timeout: NodeJS.Timeout | undefined;

  const triggerUpdate = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      if (activeEditor) {
        updateDecorations(activeEditor);
      }
    }, DEBOUNCE_DELAY);
  };

  if (activeEditor) {
    triggerUpdate();
  }

  // The previews are read from the built dictionaries, not from the source
  // content files — without this the active editor keeps showing stale (or no)
  // previews until it is edited or reopened.
  const dictionaryWatcher = workspace.createFileSystemWatcher(
    DICTIONARY_OUTPUT_GLOB
  );

  return [
    window.onDidChangeActiveTextEditor((editor) => {
      activeEditor = editor;

      if (editor) {
        triggerUpdate();
      }
    }),
    workspace.onDidChangeTextDocument((event) => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdate();
      }
    }),
    dictionaryWatcher,
    dictionaryWatcher.onDidCreate(triggerUpdate),
    dictionaryWatcher.onDidChange(triggerUpdate),
    dictionaryWatcher.onDidDelete(triggerUpdate),
  ];
};

const allowedExtensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.json5',
  '.vue',
  '.svelte',
  '.astro',
];

const updateDecorations = async (editor: TextEditor) => {
  const document = editor.document;

  const extension = extname(document.uri.fsPath).toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    return;
  }

  const filePath = document.uri.fsPath;
  const fileDir = dirname(filePath);
  const projectDir = findProjectRoot(fileDir);

  if (!projectDir) {
    return;
  }

  const config = await getCachedConfig(projectDir);
  const defaultLocale =
    config.internationalization?.defaultLocale || DEFAULT_LOCALE;

  const scriptContent = extractScriptContent(document.getText(), extension);

  // Registry-driven analysis from @intlayer/lsp: covers useIntlayer member
  // chains AND every compat form — t('path') calls, formatMessage({ id }),
  // <FormattedMessage id>, <Trans i18nKey|id>, lingui t`…` / i18n._().
  const usages = collectMessageUsages(scriptContent);
  const bindings = collectCallerBindings(scriptContent);

  const translationDecorations: DecorationOptions[] = [];
  const duplicateDecorations: DecorationOptions[] = [];
  const processedLines = new Set<number>();

  const localDictionaryCache = new Map<string, any[]>();

  const getDictionaries = async (dictionaryKey: string): Promise<any[]> => {
    let dictionaries = localDictionaryCache.get(dictionaryKey);

    if (!dictionaries) {
      const dictionaryJsonPath = join(
        config.system.unmergedDictionariesDir,
        `${dictionaryKey}.json`
      );
      dictionaries = (await getCachedDictionary(dictionaryJsonPath)) || [];
      localDictionaryCache.set(dictionaryKey, dictionaries!);
    }

    return dictionaries!;
  };

  const getDictionaryContent = async (
    dictionaryKey: string
  ): Promise<any | null> => {
    const dictionaries = await getDictionaries(dictionaryKey);
    const localDictionary = dictionaries.find(
      (dictionary) => dictionary.content
    );

    return localDictionary?.content ?? null;
  };

  const addTranslationDecoration = (endOffset: number, displayText: string) => {
    const position = document.positionAt(endOffset);
    const lineIndex = position.line;

    if (processedLines.has(lineIndex)) {
      return;
    }

    const line = document.lineAt(lineIndex);
    const range = new Range(line.range.end, line.range.end);

    translationDecorations.push({
      range,
      hoverMessage: displayText,
      renderOptions: {
        after: {
          contentText: `    ${displayText}`,
          color: 'rgba(128, 128, 128, 0.3)',
        },
      },
    });
    processedLines.add(lineIndex);
  };

  for (const usage of usages) {
    // Dictionary-level call site → show the multi-declaration label
    if (usage.kind === 'namespace') {
      const dictionaries = await getDictionaries(usage.dictionaryKey);

      if (dictionaries.length > 1) {
        let localCount = 0;
        let remoteCount = 0;

        dictionaries.forEach((dictionary) => {
          if (
            dictionary.filePath ||
            dictionary.location === 'local' ||
            dictionary.location === 'hybrid' ||
            dictionary.location === undefined
          ) {
            localCount++;
          }

          if (dictionary.location === 'remote') {
            remoteCount++;
          }
        });

        let label = `(${dictionaries.length} declarations - ${localCount} local`;

        if (remoteCount > 0) {
          label += ` / ${remoteCount} remote`;
        }
        label += `)`;

        const position = document.positionAt(usage.end);
        const range = new Range(position, position);

        duplicateDecorations.push({
          range,
          renderOptions: {
            after: {
              contentText: label,
            },
          },
        });
      }
      continue;
    }

    // Declarations (destructure keys) are not decorated — only usages.
    if (usage.kind === 'destructure') continue;

    if (usage.fieldPath.length === 0) continue;

    const dictionaryContent = await getDictionaryContent(usage.dictionaryKey);

    if (!dictionaryContent) continue;

    const rawValue = getValueFromPath(
      dictionaryContent,
      usage.fieldPath,
      defaultLocale
    );

    if (!rawValue) continue;

    const displayText = parseContentValue(rawValue);

    if (!displayText) continue;

    addTranslationDecoration(usage.end, displayText);
  }

  // ---------------------------------------------------------------------
  // Template regions (Angular inline templates, Vue <template>) — the AST
  // does not reach them, so bound variables are traced with regexes.
  // ---------------------------------------------------------------------

  const contentBindings = bindings.filter(
    (binding) => binding.bindingKind === 'content'
  );
  const translatorBindings = bindings.filter(
    (binding) => binding.bindingKind === 'translator'
  );

  const decorateTemplate = async (
    templateStart: number,
    templateContent: string
  ) => {
    for (const binding of contentBindings) {
      const dictionaryContent = await getDictionaryContent(
        binding.dictionaryKey
      );

      if (!dictionaryContent) continue;

      const targets = [
        { name: binding.variableName, pathPrefix: [] as string[] },
      ];

      // Detect `as` aliases (e.g. content.title as myTitle)
      const aliasPattern = new RegExp(
        `\\b${binding.variableName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\s+as\\s+([a-zA-Z0-9_]+)`,
        'g'
      );

      for (const aliasMatch of templateContent.matchAll(aliasPattern)) {
        const extraPath = aliasMatch[1]
          ? aliasMatch[1].split('.').filter(Boolean)
          : [];
        targets.push({ name: aliasMatch[2], pathPrefix: extraPath });
      }

      for (const { name: targetName, pathPrefix } of targets) {
        const usageRegex = new RegExp(
          `\\b${targetName}(?:\\(\\))?((?:\\.[a-zA-Z0-9_]+)*)\\b`,
          'g'
        );

        for (const usageMatch of templateContent.matchAll(usageRegex)) {
          const keys = usageMatch[1]
            ? usageMatch[1].split('.').filter(Boolean)
            : [];
          const contentPath = [...binding.basePath, ...pathPrefix, ...keys];

          const rawValue = getValueFromPath(
            dictionaryContent,
            contentPath,
            defaultLocale
          );

          if (!rawValue) continue;

          const displayText = parseContentValue(rawValue);

          if (!displayText) continue;

          addTranslationDecoration(
            templateStart + usageMatch.index! + usageMatch[0].length,
            displayText
          );
        }
      }
    }

    // Translation calls in templates: {{ t('path.to.field') }} (vue-i18n)
    for (const binding of translatorBindings) {
      const dictionaryContent = await getDictionaryContent(
        binding.dictionaryKey
      );

      if (!dictionaryContent) continue;

      const callRegex = new RegExp(
        `\\b${binding.variableName}\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'g'
      );

      for (const callMatch of templateContent.matchAll(callRegex)) {
        const contentPath = [...binding.basePath, ...callMatch[1]!.split('.')];

        const rawValue = getValueFromPath(
          dictionaryContent,
          contentPath,
          defaultLocale
        );

        if (!rawValue) continue;

        const displayText = parseContentValue(rawValue);

        if (!displayText) continue;

        addTranslationDecoration(
          templateStart + callMatch.index! + callMatch[0].length,
          displayText
        );
      }
    }
  };

  // Angular inline templates
  if (extension === '.ts' && document.getText().includes('@Component')) {
    const text = document.getText();
    const templateRegex = /template\s*:\s*(["'`])([\s\S]*?)\1/g;

    for (const templateMatch of text.matchAll(templateRegex)) {
      const templateStart =
        templateMatch.index! + templateMatch[0].indexOf(templateMatch[2]);
      await decorateTemplate(templateStart, templateMatch[2]);
    }
  }

  // Vue <template> block (stripped from the parsed script, searched here)
  if (extension === '.vue') {
    const rawText = document.getText();
    const templateBlockMatch =
      /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/i.exec(rawText);

    if (templateBlockMatch) {
      const templateStart =
        templateBlockMatch.index + templateBlockMatch[1].length;
      await decorateTemplate(templateStart, templateBlockMatch[2]);
    }
  }

  editor.setDecorations(translationDecorationType, [
    ...translationDecorations,
    ...duplicateDecorations,
  ]);
};

// Content Parsing Helpers

const parseContentValue = (value: any): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  let text = '';

  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number') {
    text = String(value);
  } else if (typeof value === 'object') {
    if (Array.isArray(value)) {
      text = value.map(parseContentValue).join('');
    } else if (isValidElementLike(value)) {
      text = extractTextFromReactNode(value);
    } else {
      return null;
    }
  }

  if (!text) {
    return null;
  }

  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > TRUNCATE_LENGTH) {
    return `${text.substring(0, TRUNCATE_LENGTH)}...`;
  }
  return text;
};

const isValidElementLike = (obj: any): boolean =>
  obj &&
  typeof obj === 'object' &&
  'props' in obj &&
  (!('key' in obj) || obj.key === null || typeof obj.key === 'string');

const extractTextFromReactNode = (node: any): string => {
  if (!node) {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).join('');
  }

  if (typeof node === 'object' && node.props && node.props.children) {
    return extractTextFromReactNode(node.props.children);
  }

  return '';
};
