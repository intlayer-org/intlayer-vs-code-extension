# Change Log

All notable changes to the "intlayer" extension will be documented in this file.

## [Unreleased]

## 2025-09-24

- Changed: bump version to 6.0.2
- Added: new commands available from Command Palette and views:
  - Intlayer: Build Current Dictionary (`extension.buildActiveDictionary`)
  - Intlayer: Fill Current Dictionary (`extension.fillActiveDictionary`)
  - Intlayer: Refresh Dictionaries (`intlayer.refreshDictionaries`)
  - Intlayer: Fill Dictionary (`intlayer.fillDictionary`)
  - Intlayer: Pull Dictionary (`intlayer.pullDictionary`)
  - Intlayer: Push Dictionary (`intlayer.pushDictionary`)
  - Intlayer: Select Environment (`intlayer.selectEnvironment`)
  - Intlayer: Create Content File (`extension.createDictionaryFile`) and format-specific variants:
    - TypeScript (`extension.createDictionaryFile.ts`)
    - ESM (`extension.createDictionaryFile.esm`)
    - CommonJS (`extension.createDictionaryFile.cjs`)
    - JSON (`extension.createDictionaryFile.json`)
- Docs: update README Commands and Activity Bar documentation

## 2025-09-21

- Added: new Intlayer Activity Bar tab with two views:
  - Search webview (`intlayer.searchBar`) for live dictionary/content search
  - Dictionaries tree (`intlayer.dictionaries`) with environments, dictionaries, and files
- Added: toolbar actions on Dictionaries view (Build, Pull, Push, Fill, Refresh, Test, Create File)
- Added: context menu actions (Fill on files; Pull/Push on dictionaries)
- Added: auto-reveal current editor file in Dictionaries tree
- Added: fill and test commands

## 2025-08-13

- Changed: update package versions to 5.7.7
- Added: add .env to .vscodeignore

## 2025-06-11

- Added: add .env for access token storage
- Changed: update packages version for Windows compatibility

## 2025-06-06

- Changed: update Intlayer packages

## 2025-06-02

- Docs: update README

## 2025-05-25

- Added: update VS Code extension version
- Added: update VS Code extension to work with new Intlayer version

## 2025-04-11

- Changed: update package version (core)
- Fixed: make extension compatible with Cursor

## 2025-03-22

- Fixed: correct variable name in dictionary content generation and reorder import statement

## 2025-03-17

- Docs/Chore: update docs and increment package version to 5.3.12
- Added: integrate project root detection and configuration for dictionary file generation
- Chore: increment package version to 5.3.11
- Fixed: fix project root detection logic
- Chore: increment package version to 5.3.10
- Added: enhance exported component name detection with additional regex patterns
- Added: add icon and license file; update README and package.json for extension name change
- Chore: update dependencies to 5.3.6 and increment package version to 5.3.6
- Added: implement extension feature

## 2025-03-16

- Chore: update @intlayer dependencies to 5.3.5
- Added: initialize project structure with configuration files and core functionality
