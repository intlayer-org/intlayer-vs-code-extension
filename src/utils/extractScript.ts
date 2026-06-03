/**
 * Extracts script content from Svelte, Vue, and Astro files while preserving offsets.
 * Non-script content is replaced with spaces (same length) so byte offsets stay valid.
 */
export const extractScriptContent = (
  text: string,
  extension: string,
): string => {
  if (
    extension !== ".vue" &&
    extension !== ".svelte" &&
    extension !== ".astro"
  ) {
    return text;
  }

  if (extension === ".astro") {
    return extractAstroScript(text);
  }

  let processedText = text;

  if (extension === ".vue") {
    // Strip <template> and <style> blocks entirely so Vue-specific syntax
    // (@click, :class, v-for, CSS) doesn't break Babel JSX parsing.
    // Offset preservation: every char is replaced 1-for-1 with a space.
    processedText = stripBlockContent(processedText, "template");
    processedText = stripBlockContent(processedText, "style");
  }

  // Replace <script> / </script> tags with spaces (keep the script body).
  const scriptTagRegex = /(<script\b[^>]*>)|(<\/script>)/gi;
  processedText = processedText.replace(scriptTagRegex, (match) =>
    " ".repeat(match.length),
  );

  if (extension === ".svelte") {
    // Replace entire Svelte control-flow and special-tag blocks with spaces so
    // their contents don't produce stray tokens that break the JS/TS parser.
    // Pattern covers: {#if …} {#each … as …} {:else} {/each} {@html …} {@const …}
    // Normal Svelte expressions like {$app.title} are NOT matched (no #/:/@).
    processedText = processedText.replace(/\{[#/:@][^}]*\}/gi, (match) =>
      " ".repeat(match.length),
    );
  }

  return processedText;
};

/** Replace an entire <tagName>...</tagName> block with spaces (preserves length). */
const stripBlockContent = (text: string, tagName: string): string =>
  text.replace(
    new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`, "gi"),
    (_, open, content, close) =>
      " ".repeat(open.length) +
      " ".repeat(content.length) +
      " ".repeat(close.length),
  );

/**
 * For Astro files: replace the two `---` frontmatter delimiters with spaces so
 * the frontmatter JS/TS becomes a plain module body parseable by Babel.
 * The HTML template below the frontmatter is JSX-compatible and stays intact.
 * Client-side <script> and <style> blocks are stripped to avoid parse errors.
 */
const extractAstroScript = (text: string): string => {
  let result = text;

  const firstDelim = result.indexOf("---");
  if (firstDelim !== -1) {
    result = `${result.slice(0, firstDelim)}   ${result.slice(firstDelim + 3)}`;

    const secondDelim = result.indexOf("---", firstDelim + 3);
    if (secondDelim !== -1) {
      result =
        `${result.slice(0, secondDelim)}   ${result.slice(secondDelim + 3)}`;
    }
  }

  // Strip client-side <script> and <style> blocks so their JS/CSS doesn't
  // confuse Babel when it parses the remaining JSX template.
  result = stripBlockContent(result, "script");
  result = stripBlockContent(result, "style");

  return result;
};
