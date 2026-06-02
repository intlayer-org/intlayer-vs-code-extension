# Intlayer Language Server (LSP)

The Intlayer VS Code extension ships with a built-in Language Server Protocol (LSP) client that connects to the [`@intlayer/lsp`](https://www.npmjs.com/package/@intlayer/lsp) server. Together they power **Go to Definition** for `useIntlayer` / `getIntlayer` dictionary keys.

---

## What it does

When you Ctrl+Click (or F12) on a key string inside a `useIntlayer` or `getIntlayer` call, the LSP resolves which `.content.*` file declares that key and jumps your cursor to the `key:` line inside that file.

```ts
// Component file
const content = useIntlayer("homepage");
//                           ^^^^^^^^^
//                           Ctrl+Click → jumps to homepage.content.ts
```

Multi-line calls are supported:

```ts
const content = useIntlayer(
  "my-super-long-key",
  //  ^^^^^^^^^^^^^^^
  //  Ctrl+Click works here too
);
```

---

## Architecture

```
VS Code extension (client)
        │  stdio
        ▼
@intlayer/lsp (server process)
        │
        ├─ reads workspace config  (@intlayer/config)
        ├─ reads unmerged dictionaries  (@intlayer/unmerged-dictionaries-entry)
        └─ handles textDocument/definition requests
```

The server is a standalone Node.js process that communicates over **stdio** using the Language Server Protocol. The extension spawns it once per workspace and keeps it running in the background.

---

## Supported call patterns

The server recognises all Intlayer content getters regardless of the framework package:

| Function        | Package examples                                                        |
| --------------- | ----------------------------------------------------------------------- |
| `useIntlayer`   | `react-intlayer`, `next-intlayer`, `vue-intlayer`, `svelte-intlayer`, … |
| `getIntlayer`   | `intlayer`, `express-intlayer`, `hono-intlayer`, …                      |
| `useDictionary` | `react-intlayer`, `next-intlayer`, …                                    |
| `getDictionary` | `intlayer`, …                                                           |

Generic type arguments and optional whitespace (including newlines) between the function name and the opening parenthesis are handled:

```ts
useIntlayer<Locale>("key");
getIntlayer("key");
useIntlayer("key");
```

---

## How definition resolution works

1. The server receives the cursor position from VS Code.
2. It scans the document text with the regex:

   ```
   \b(useIntlayer|getIntlayer)\b
     \s*(?:<[^<>()]*>)?\s*\(\s*(['"`])([^'"`]+)\2
   ```

3. If the cursor falls inside a match, the captured key (group 3) is looked up against the cached unmerged dictionaries for the workspace.
4. For each dictionary that declares the key, the server reads its source file, finds the `key: "…"` line, and returns a `Location` pointing at that line.

---

## Relationship to the built-in provider

The extension also contains a pure VS Code API provider (`redirectUseIntlayerKeyToDictionary`) that does the same job without spawning an external process. The LSP client runs **alongside** it; VS Code merges definition results from all registered providers.

The LSP server offers broader compatibility (any editor that speaks LSP) while the built-in provider acts as an immediate fallback inside VS Code.

---

## Configuration

No configuration is required. The server is bundled with the extension and starts automatically when any supported file language is opened.

The server infers the project root from the workspace folder passed during LSP initialisation and then reads the Intlayer configuration (`intlayer.config.*`) from that root, matching exactly the same logic used by the CLI and the build tools.
