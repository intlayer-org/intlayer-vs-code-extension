/**
 * Utility to resolve Intlayer nodes (Translation, Markdown, HTML, Insertion, etc.)
 * into their actual content based on the provided locale.
 */

export const resolveIntlayerNode = (node: any, locale: string): any => {
  if (!node) return node;

  let current = node;

  // 1. Unwrap structural wrappers (markdown, html, insertion, content)
  const wrapperKeys = ["markdown", "html", "insertion", "content"];
  while (
    current &&
    typeof current === "object" &&
    current.nodeType &&
    wrapperKeys.includes(current.nodeType)
  ) {
    const contentKey =
      current.nodeType === "insertion" ? "insertion" : current.nodeType;
    if (current[contentKey] !== undefined) {
      current = current[contentKey];
    } else if (current.content !== undefined) {
      current = current.content;
    } else {
      break;
    }
  }

  // 2. Resolve Translation node
  if (
    current &&
    typeof current === "object" &&
    current.nodeType === "translation" &&
    current.translation
  ) {
    const localizedValue =
      current.translation[locale] ??
      current.translation["en"] ?? // Try English fallback
      Object.values(current.translation)[0]; // Fallback to first available
    return resolveIntlayerNode(localizedValue, locale);
  }

  return current;
};

/**
 * Traverses a dictionary content object using a path of keys.
 * Automatically skips framework-specific methods like .use, .value, .raw.
 */
export const getValueFromPath = (
  content: any,
  path: string[],
  locale: string
): any => {
  let current = content;

  for (const key of path) {
    // Skip framework-specific methods that might be in the path
    if (key === "use" || key === "value" || key === "raw") {
      continue;
    }

    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }

  return resolveIntlayerNode(current, locale);
};
