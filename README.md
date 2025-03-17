# Intlayer

🚀 **Intlayer** enhances your VS Code experience by enabling **Go to Definition** support for `useIntlayer` keys in React projects. With this extension, you can **command-click** (`Ctrl+Click` on Windows/Linux) on a `useIntlayer` key and instantly navigate to the corresponding content file.

## ✨ Features

✅ **Instant Navigation** – Quickly jump to the correct content file when clicking on a `useIntlayer` key.  
✅ **Seamless Integration** – Works with **React, TypeScript, and JavaScript** projects using `react-intlayer` and `next-intlayer`.
✅ **Enhanced Developer Experience** – Eliminates the need to manually search for content files.  
✅ **Works with Localized Content** – Supports multi-language projects powered by Intlayer.  
✅ **Dictionary Commands** – Build, push, or pull content dictionaries with ease.  
✅ **Content Declaration Generator** – Create dictionary content files in various formats (`.ts`, `.esm`, `.cjs`, `.json`).

## 🛠️ Installation

1. Open **VS Code**.
2. Go to the **Extensions Marketplace**.
3. Search for **"Intlayer"**.
4. Click **Install**.

Alternatively, install it via the command line:

```sh
code --install-extension intlayer
```

## 🚀 Usage

1. Open a project using **react-intlayer**.
2. Find any call to `useIntlayer()`, for example:

   ```tsx
   const content = useIntlayer("app");
   ```

3. **Command-click** (`⌘+Click` on macOS) or **Ctrl+Click** (on Windows/Linux) on `"app"`.
4. VS Code will **automatically open** the corresponding content file, e.g., `examples/vite-app/src/app.content.tsx`.

## 🛠️ Commands

Intlayer includes several commands to help you manage content dictionaries efficiently. You can access them via the **Command Palette (`Cmd + Shift + P` on macOS / `Ctrl + Shift + P` on Windows/Linux)**.

### 📌 Dictionary Management

- **Build Dictionaries** (`extension.buildDictionaries`)  
  Builds all dictionary content files based on the current project structure.

- **Push Dictionaries** (`extension.pushDictionaries`)  
  Uploads the latest dictionary content to your content repository.

- **Pull Dictionaries** (`extension.pullDictionaries`)  
  Syncs the latest dictionary content from your content repository to your local environment.

### 📜 Content Declaration File Generator

The extension allows you to generate dictionary content files in different formats:

- **TypeScript (`.ts`)** – `extension.createDictionaryFile.ts`
- **ES Module (`.esm`)** – `extension.createDictionaryFile.esm`
- **CommonJS (`.cjs`)** – `extension.createDictionaryFile.cjs`
- **JSON (`.json`)** – `extension.createDictionaryFile.json`

These commands automatically generate properly structured dictionary files, making it easier to manage localized content.

## 🛠️ Configuration

By default, the extension follows the standard Intlayer project structure. If your content files are stored in a different location, you can configure it via VS Code settings:

1. Open **Settings (`Cmd + ,` on macOS / `Ctrl + ,` on Windows/Linux)`**
2. Search for `Intlayer`
3. Set your **custom content file path pattern** if needed.

## 🔄 Development & Contribution

Interested in improving the extension? Contributions are welcome!

### Clone the repository:

```sh
git clone https://github.com/your-username/intlayer.git
cd intlayer
npm install
```

### Run in development mode:

1. Open the project in **VS Code**.
2. Press `F5` to launch a new **Extension Development Host** window.

## 📮 Feedback & Issues

If you encounter any issues or have feature requests, please open an issue on [GitHub](https://github.com/your-username/intlayer/issues).

## 📜 License

This extension is licensed under the **MIT License**.
