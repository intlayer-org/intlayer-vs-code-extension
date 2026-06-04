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

  if (extension === ".svelte") {
    // Svelte SFCs have Svelte-specific template syntax (class:name, on:event,
    // {#each}, etc.) that is not valid JSX and causes oxc to produce a broken
    // AST when the template is present. Strip everything outside <script> blocks
    // (same strategy Vue uses for <template> and <style>).
    return extractSvelteScript(text);
  }

  // Vue: strip <template> and <style> blocks so Vue-specific syntax
  // (@click, :class, v-for, CSS) doesn't break the JS/TS parser.
  // Offset preservation: every char is replaced 1-for-1 with a space.
  let processedText = stripBlockContent(text, "template");
  processedText = stripBlockContent(processedText, "style");

  // Replace <script> / </script> tags with spaces (keep the script body).
  const scriptTagRegex = /(<script\b[^>]*>)|(<\/script>)/gi;
  processedText = processedText.replace(scriptTagRegex, (match) =>
    " ".repeat(match.length),
  );

  return processedText;
};

/**
 * Svelte: keep only the content of <script>...</script> blocks, replace
 * everything else (template, style, Svelte directives) with spaces.
 *
 * Byte offsets are preserved because replacements are always 1-for-1 spaces.
 * The opening/closing <script> tags also become spaces; only the body remains.
 *
 * Offset formula: body starts at  match.index + 7 (for "<script") + attrs.length + 1 (for ">")
 */
const extractSvelteScript = (text: string): string => {
  let result = " ".repeat(text.length);

  for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]!;
    const body = match[2]!;
    // "<script" = 7 chars, attrs captured, ">" = 1 char → body starts here
    const bodyStart = match.index! + 7 + attrs.length + 1;
    result = result.slice(0, bodyStart) + body + result.slice(bodyStart + body.length);
  }

  return result;
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
