/**
 * Extracts script content from Svelte and Vue files while preserving offsets.
 * Non-script content is kept but modified to be more TSX-compatible.
 */
export const extractScriptContent = (
  text: string,
  extension: string,
): string => {
  if (extension !== ".vue" && extension !== ".svelte") {
    return text;
  }

  let processedText = text;

  // Replace <script> and </script> tags with spaces to preserve offsets
  const scriptRegex = /(<script\b[^>]*>)|(<\/script>)/gi;
  processedText = processedText.replace(scriptRegex, (match) =>
    " ".repeat(match.length),
  );

  // 2. Replace other tags that might break parsing (like <template>, <style>)
  const otherTagsRegex = /(<\/?(?:template|style)\b[^>]*>)/gi;
  processedText = processedText.replace(otherTagsRegex, (match) =>
    " ".repeat(match.length),
  );

  // Make template content more TSX-compatible
  if (extension === ".vue") {
    // Vue: Replace {{ ... }} with { ... }
    processedText = processedText.replace(/{{/g, " {").replace(/}}/g, "} ");
  } else if (extension === ".svelte") {
    // Svelte: Replace {#...}, {/...}, {:...}, {@...} with spaces but keep content length
    processedText = processedText.replace(/\{[#/:@][a-z0-9]*/gi, (match) =>
      " ".repeat(match.length),
    );
  }

  return processedText;
};
