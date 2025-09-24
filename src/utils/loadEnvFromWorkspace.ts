import { window, workspace, Uri } from "vscode";
import { parse } from "dotenv";
import { join } from "path";

export const loadEnvFromWorkspace = async (
  baseDir: string,
  env?: string
): Promise<Record<string, string> | undefined> => {
  const folders = workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace is open.");
  }

  const candidates = [
    ...(env ? [`.env.${env}.local`, `.env.${env}`] : []),
    ".env.local",
    ".env",
  ];

  for (const candidate of candidates) {
    try {
      const uri = Uri.file(join(baseDir, candidate));
      const bytes = await workspace.fs.readFile(uri);
      const content = new TextDecoder("utf-8").decode(bytes);
      const parsed = parse(content);

      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) {
          process.env[k] = v;
        }
      }

      window.showInformationMessage(`Loaded env from ${candidate}`);
      return parsed;
    } catch (err) {
      // Try next candidate
      continue;
    }
  }

  return undefined;
};
