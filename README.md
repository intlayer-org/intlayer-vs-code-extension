# Intlayer Navigator

🚀 **Intlayer Navigator** enhances your VS Code experience by enabling **Go to Definition** support for `useIntlayer` keys in React projects. With this extension, you can **command-click** (`Ctrl+Click` on Windows/Linux) on an `useIntlayer` key and instantly navigate to the corresponding content file.

## ✨ Features

✅ **Instant Navigation** – Quickly jump to the correct content file when clicking on an `useIntlayer` key.  
✅ **Seamless Integration** – Works with **React, TypeScript, and JavaScript** projects using `react-intlayer`.  
✅ **Enhanced Developer Experience** – Eliminates the need to manually search for content files.  
✅ **Works with Localized Content** – Supports multi-language projects powered by Intlayer.

## 🛠️ Installation

1. Open **VS Code**.
2. Go to the **Extensions Marketplace**.
3. Search for **"Intlayer Navigator"**.
4. Click **Install**.

Alternatively, you can install it via the command line:

```sh
code --install-extension intlayer-navigator
```

## 🚀 Usage

1. Open a project using **react-intlayer**.
2. Find any call to `useIntlayer()`, for example:

   ```tsx
   const content = useIntlayer("app");
   ```

3. **Command-click** (`⌘+Click` on macOS) or **Ctrl+Click** (on Windows/Linux) on `"app"`.
4. VS Code will **automatically open** the corresponding content file, e.g., `examples/vite-app/src/app.content.tsx`.

## 🛠️ Configuration

By default, the extension follows the standard Intlayer project structure. If your content files are stored in a different location, you can configure it via VS Code settings:

1. Open **Settings (`Cmd + ,` on macOS / `Ctrl + ,` on Windows/Linux)**
2. Search for `Intlayer Navigator`
3. Set your **custom content file path pattern** if needed.

## 🔄 Development & Contribution

Interested in improving the extension? Contributions are welcome!

### Clone the repository:

```sh
git clone https://github.com/your-username/intlayer-navigator.git
cd intlayer-navigator
npm install
```

### Run in development mode:

1. Open the project in **VS Code**.
2. Press `F5` to launch a new **Extension Development Host** window.

## 📮 Feedback & Issues

If you encounter any issues or have feature requests, please open an issue on [GitHub](https://github.com/your-username/intlayer-navigator/issues).

## 📜 License

This extension is licensed under the **MIT License**.
