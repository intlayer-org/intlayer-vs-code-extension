# Intlayer

**Intlayer** enhances your VS Code experience by enabling **Go to Definition** support for `useIntlayer` keys in React projects. With this extension, you can **command-click** (`Ctrl+Click` on Windows/Linux) on a `useIntlayer` key and instantly navigate to the corresponding content file.

![Intlayer VS Code Extension](https://github.com/aymericzip/intlayer/blob/main/docs/assets/vs_code_extension_demo.gif?raw=true)

## Features

- **Instant Navigation** – Quickly jump to the correct content file when clicking on a `useIntlayer` key.
- **Seamless Integration** – Works with **React, TypeScript, and JavaScript** projects using `react-intlayer` and `next-intlayer`.
- **Enhanced Developer Experience** – Eliminates the need to manually search for content files.
- **Works with Localized Content** – Supports multi-language projects powered by Intlayer.
- **Dictionary Commands** – Build, push, or pull content dictionaries with ease.
- **Content Declaration Generator** – Create dictionary content files in various formats (`.ts`, `.esm`, `.cjs`, `.json`).
- **Fill Dictionaries** – Fill dictionaries with content from your project.
- **Test Dictionaries** – Test dictionaries for missing translations.
- **Intlayer Tab (Activity Bar)** – Browse and search dictionaries from a dedicated side tab with toolbar and context actions (Build, Pull, Push, Fill, Refresh, Test, Create File).

### Intlayer Tab (Activity Bar)

Open the Intlayer tab by clicking the Intlayer icon in the VS Code Activity Bar. It contains two views:

- **Search**: A live search bar to quickly filter dictionaries and their content. Typing updates the results instantly.
- **Dictionaries**: A tree view of your environments/projects, dictionary keys, and the files contributing entries. You can:
  - Click a file to open it in the editor.
  - Use the toolbar to run actions: Build, Pull, Push, Fill, Refresh, Test, and Create Dictionary File.
  - Use the context menu for item‑specific actions:
    - On a dictionary: Pull or Push
    - On a file: Fill Dictionary
  - When you switch editors, the tree will reveal the matching file if it belongs to a dictionary.

## Documentation

Check out the [documentation](https://intlayer.org/docs/vs-code-extension) for more information on how to use Intlayer with VS Code.

## Usage

1. Open a project using **intlayer**, **react-intlayer**, **next-intlayer**, **vue-intlayer**, **nuxt-intlayer**, etc.
2. Find any call to `useIntlayer()`, for example:

   ```tsx
   const content = useIntlayer("app");
   ```

3. **Command-click** (`⌘+Click` on macOS) or **Ctrl+Click** (on Windows/Linux) on `"app"`.
4. VS Code will **automatically open** the corresponding content file, e.g., `examples/vite-app/src/app.content.tsx`.

## Commands

Intlayer includes several commands to help you manage content dictionaries efficiently. You can access them via the **Command Palette (`Cmd + Shift + P` on macOS / `Ctrl + Shift + P` on Windows/Linux)**.

### Dictionary Management

- **Build Dictionaries** (`extension.buildDictionaries`)  
  Builds all dictionary content files based on the current project structure.

- **Push Dictionaries** (`extension.pushDictionaries`)  
  Uploads the latest dictionary content to your content repository.

- **Pull Dictionaries** (`extension.pullDictionaries`)  
  Syncs the latest dictionary content from your content repository to your local environment.

- **Fill Dictionaries** (`extension.fillDictionaries`)  
  Fills the dictionaries with content from your project.

- **Test Dictionaries** (`extension.testDictionaries`)  
  Test dictionaries for missing translations.

### Content Declaration Generator

Easily generate structured dictionary files in different formats:

If you're currently working on a component, it will generate the `.content.{ts,tsx,js,jsx,mjs,cjs,json}` file for you.

Example of component:

```tsx fileName="src/components/MyComponent/index.tsx"
const MyComponent = () => {
  const { myTranslatedContent } = useIntlayer("my-component");

  return <span>{myTranslatedContent}</span>;
};
```

Generated file in TypeScript format:

```tsx fileName="src/components/MyComponent/index.content.ts"
import { t, type Dictionary } from "intlayer";

const componentContent = {
  key: "my-component",
  content: {
    myTranslatedContent: t({
      en: "Hello World",
      es: "Hola Mundo",
      fr: "Bonjour le monde",
    }),
  },
};

export default componentContent;
```

Available formats:

- **TypeScript (`.ts`)**
- **ES Module (`.esm`)**
- **CommonJS (`.cjs`)**
- **JSON (`.json`)**

## Development & Contribution

Interested in improving the extension? Contributions are welcome! See [CONTRIBUTING.md](https://github.com/aymericzip/intlayer/blob/main/CONTRIBUTING.md) for more information.

## Feedback & Issues

If you encounter any issues or have feature requests, please open an issue on [GitHub](https://github.com/aymericzip/intlayer/issues).

## 📜 License

This extension is licensed under the **MIT License**.
