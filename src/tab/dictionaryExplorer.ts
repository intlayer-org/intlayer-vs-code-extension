import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, extname, join, relative } from "path";
import {
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
} from "vscode";
import { getConfiguration } from "@intlayer/config";
import { findAllProjectRoots } from "../utils/findProjectRoot";
import { getSelectedEnvironment } from "../utils/envStore";

type DictionaryEntry = {
  filePath?: string;
};

type EnvironmentNode = {
  type: "environment";
  label: string;
  projectDir: string;
  dir: string; // unmerged dictionaries dir
};

type DictionaryNode = {
  type: "dictionary";
  key: string;
  jsonPath: string;
  projectDir: string;
  envLabel: string;
};

type FileNode = {
  type: "file";
  filePath: string;
  projectDir: string;
  dictionaryJsonPath: string;
};

export type IntlayerTreeNode = EnvironmentNode | DictionaryNode | FileNode;

export class DictionaryTreeDataProvider
  implements TreeDataProvider<IntlayerTreeNode>
{
  private readonly changeEmitter = new EventEmitter<IntlayerTreeNode | void>();
  readonly onDidChangeTreeData: Event<IntlayerTreeNode | void> =
    this.changeEmitter.event;

  private searchQuery: string | undefined;
  private cachedEnvironments:
    | { projectDir: string; dir: string; files: string[]; label: string }[]
    | undefined;

  setSearchQuery(query: string | undefined) {
    this.searchQuery =
      query && query.trim().length > 0 ? query.trim() : undefined;
    this.refresh();
  }

  getSearchQuery(): string {
    return this.searchQuery || "";
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  /**
   * Find a file node by its project-relative path across all dictionaries.
   */
  async findFileNodeByAbsolutePath(
    absolutePath: string
  ): Promise<IntlayerTreeNode | undefined> {
    if (!this.cachedEnvironments) {
      await this.getChildren();
    }
    const envs = this.cachedEnvironments || [];
    for (const env of envs) {
      const relPath = relative(env.projectDir, absolutePath);
      // If the absolute path is outside this env, the relative path will start with ..
      if (relPath.startsWith("..")) {
        continue;
      }
      for (const file of env.files) {
        try {
          const jsonPath = join(env.dir, file);
          const content = readFileSync(jsonPath, "utf8");
          const dictionaries = JSON.parse(content) as DictionaryEntry[];
          const hasMatch = (dictionaries || [])
            .filter(Boolean)
            .some((d) => d.filePath === relPath);
          if (hasMatch) {
            return {
              type: "file",
              filePath: relPath,
              projectDir: env.projectDir,
              dictionaryJsonPath: jsonPath,
            };
          }
        } catch {
          // ignore malformed files
        }
      }
    }
    return undefined;
  }

  async getChildren(element?: IntlayerTreeNode): Promise<IntlayerTreeNode[]> {
    try {
      if (!element) {
        const roots = findAllProjectRoots();
        if (!roots.length) {
          return [];
        }

        const envs: {
          projectDir: string;
          dir: string;
          files: string[];
          label: string;
        }[] = [];
        for (const projectDir of roots) {
          try {
            const config = getConfiguration({ baseDir: projectDir });
            const dir = config.content.unmergedDictionariesDir;
            if (!dir || !existsSync(dir)) {
              continue;
            }
            const files = readdirSync(dir)
              .filter((f) => extname(f) === ".json")
              .sort();
            if (!files.length) {
              continue;
            }

            // derive label from package.json name or fallback to directory name
            let label = basename(projectDir);
            try {
              const pkg = JSON.parse(
                readFileSync(join(projectDir, "package.json"), "utf8")
              );
              if (pkg?.name && typeof pkg.name === "string") {
                label = pkg.name;
              }
            } catch {}

            envs.push({ projectDir, dir, files, label });
          } catch {
            // best effort per env
          }
        }
        this.cachedEnvironments = envs;

        // If searching, flatten all dictionaries across environments
        if (this.searchQuery) {
          const allDicts: DictionaryNode[] = envs.flatMap((env) =>
            env.files.map((file) => ({
              type: "dictionary" as const,
              key: basename(file, ".json"),
              jsonPath: join(env.dir, file),
              projectDir: env.projectDir,
              envLabel: env.label,
            }))
          );

          const Fuse = (require("fuse.js").default ||
            require("fuse.js")) as any;
          const items = allDicts.map((node) => {
            let contentString = "";
            try {
              const raw = readFileSync(node.jsonPath, "utf8");
              try {
                contentString = JSON.stringify(JSON.parse(raw));
              } catch {
                contentString = raw;
              }
            } catch {
              contentString = "";
            }
            return {
              node,
              key: node.key,
              env: node.envLabel,
              content: contentString,
            };
          });

          const fuse = new Fuse(items, {
            keys: [
              { name: "key", weight: 0.35 },
              { name: "env", weight: 0.15 },
              { name: "content", weight: 0.5 },
            ],
            threshold: 0.4,
            ignoreLocation: true,
            minMatchCharLength: 2,
          });

          const results = fuse.search(this.searchQuery);
          return results.map((r: any) => r.item.node as DictionaryNode);
        }

        // Not searching: return environments as roots
        const envNodes: EnvironmentNode[] = envs.map((env) => ({
          type: "environment",
          label: env.label,
          projectDir: env.projectDir,
          dir: env.dir,
        }));
        return envNodes;
      }

      if (element.type === "environment") {
        // List dictionaries for this environment
        const env = (this.cachedEnvironments || []).find(
          (e) => e.projectDir === element.projectDir
        );
        if (!env) {
          return [];
        }
        return env.files.map((file) => ({
          type: "dictionary" as const,
          key: basename(file, ".json"),
          jsonPath: join(env.dir, file),
          projectDir: env.projectDir,
          envLabel: env.label,
        }));
      }

      if (element.type === "dictionary") {
        try {
          const content = readFileSync(element.jsonPath, "utf8");
          const dictionaries = JSON.parse(content) as DictionaryEntry[];
          const entries = (dictionaries || []).filter(Boolean);

          let filePaths = entries
            .map((d) => d.filePath)
            .filter((p): p is string => typeof p === "string");

          if (this.searchQuery) {
            const lowered = this.searchQuery.toLowerCase();
            const jsonString = JSON.stringify(entries).toLowerCase();
            // if the whole dictionary content doesn't match, return empty children
            if (!jsonString.includes(lowered)) {
              return [];
            }
            // otherwise keep the files but we could also further filter by file path
            filePaths = filePaths
              .filter((p) => p.toLowerCase().includes(lowered))
              .concat(
                filePaths.filter((p) => !p.toLowerCase().includes(lowered))
              );
          }

          const uniquePaths = Array.from(new Set(filePaths));

          return uniquePaths.map((filePath) => ({
            type: "file",
            filePath,
            projectDir: element.projectDir,
            dictionaryJsonPath: element.jsonPath,
          }));
        } catch (error) {
          window.showWarningMessage(
            `Failed to read dictionary ${element.key}: ${(error as Error).message}`
          );
          return [];
        }
      }

      return [];
    } catch (error) {
      window.showErrorMessage(
        `Failed to load Intlayer dictionaries: ${(error as Error).message}`
      );
      return [];
    }
  }

  getParent(element: IntlayerTreeNode) {
    if (element.type === "file") {
      return {
        type: "dictionary",
        key: basename(element.dictionaryJsonPath, ".json"),
        jsonPath: element.dictionaryJsonPath,
        projectDir: element.projectDir,
        envLabel:
          (this.cachedEnvironments || []).find(
            (e) => e.projectDir === element.projectDir
          )?.label || basename(element.projectDir),
      } as DictionaryNode;
    }
    if (element.type === "dictionary") {
      const dict = element as DictionaryNode;
      const env = (this.cachedEnvironments || []).find(
        (e) => e.projectDir === dict.projectDir
      );
      if (!env) {
        return undefined;
      }
      return {
        type: "environment",
        label: env.label,
        projectDir: env.projectDir,
        dir: env.dir,
      } as EnvironmentNode;
    }
    return undefined;
  }

  getTreeItem(element: IntlayerTreeNode): TreeItem {
    if (element.type === "environment") {
      const selectedEnv = getSelectedEnvironment(element.projectDir);
      const item = new TreeItem(
        selectedEnv ? `${element.label} [${selectedEnv}]` : element.label,
        TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = "intlayer.environment";
      item.id = `env:${element.projectDir}`;
      item.tooltip = selectedEnv
        ? `${element.projectDir} — env: ${selectedEnv}`
        : element.projectDir;
      (item as any).projectDir = element.projectDir;
      return item;
    }

    if (element.type === "dictionary") {
      const item = new TreeItem(
        element.key,
        TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = "intlayer.dictionary";
      item.id = `dict:${element.jsonPath}`;
      item.tooltip = `${element.envLabel} • ${element.jsonPath}`;
      // Pass metadata for context commands
      (item as any).key = element.key;
      (item as any).projectDir = element.projectDir;
      return item;
    }

    const fileAbs = join(element.projectDir, element.filePath);
    const item = new TreeItem(element.filePath, TreeItemCollapsibleState.None);
    item.contextValue = "intlayer.file";
    item.id = `file:${element.dictionaryJsonPath}::${element.filePath}`;
    item.resourceUri = Uri.file(fileAbs);
    item.command = {
      command: "vscode.open",
      title: "Open File",
      arguments: [Uri.file(fileAbs)],
    };
    // Pass metadata for context commands
    (item as any).jsonPath = element.dictionaryJsonPath;
    (item as any).projectDir = element.projectDir;
    (item as any).filePath = element.filePath;
    return item;
  }
}
