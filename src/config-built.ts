import { createRequire } from "node:module";
import { join } from "node:path";
import { getAlias, getConfiguration } from "@intlayer/config";
import { window } from "vscode";
import { findProjectRoot } from "./utils/findProjectRoot";
import { getConfigurationOptionsSync } from "./utils/getConfiguration";
import { prefix } from "./utils/logFunctions";

const loadConfig = () => {
	const editor = window.activeTextEditor;

	if (!editor) {
		return {};
	}

	const filePath = editor.document.uri.fsPath;

	const projectDir = findProjectRoot(filePath);

	if (!projectDir) {
		return {};
	}

	try {
		const configOptions = getConfigurationOptionsSync(projectDir);

		// This config do not resolve the env vars, so we need to build it once without first to extract the location of the @intlayer/config/built alias
		// And then we return the JSON object
		const configuration = getConfiguration(configOptions);

		const configDirPath = getAlias({
			configuration,
			format: "cjs",
			formatter: (path) => join(projectDir, path),
		});

		const projectRequire = createRequire(join(projectDir, "package.json"));

		return projectRequire(configDirPath["@intlayer/config/built"]);
	} catch (error) {
		console.error(`${prefix} Error loading configuration:`, error);
		return {};
	}
};

const configJSON = new Proxy(
	{},
	{
		get: (_target, prop) => {
			const config = loadConfig();
			return config[prop];
		},
		getOwnPropertyDescriptor: (_target, prop) => {
			const config = loadConfig();
			return Object.getOwnPropertyDescriptor(config, prop);
		},
		has: (_target, prop) => {
			const config = loadConfig();
			return prop in config;
		},
		ownKeys: (_target) => {
			const config = loadConfig();
			return Reflect.ownKeys(config);
		},
	},
);

export default configJSON;
