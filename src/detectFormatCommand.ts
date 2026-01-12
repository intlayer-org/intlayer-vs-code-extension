import type { IntlayerConfig } from "@intlayer/types";

// Initialize as null to indicate "not yet checked"
let cachedFormatCommand: string | undefined | null = null;

export const detectFormatCommand = (
  configuration: IntlayerConfig,
  projectRequire: NodeJS.Require
) => {
  const { formatCommand } = configuration.content;

  // Priority: Explicit configuration
  // We do not cache this because the user might change their config file active-session.
  if (formatCommand) {
    return formatCommand;
  }

  // Priority: Cached detection
  // If not null, we have already performed the expensive checks.
  if (cachedFormatCommand !== null) {
    return cachedFormatCommand;
  }

  // Perform Detection

  // Try Prettier
  try {
    projectRequire.resolve("prettier");
    cachedFormatCommand = 'prettier --write "{{file}}" --log-level silent';
    return cachedFormatCommand;
  } catch (_error) {
    // Prettier not found, continue
  }

  // Try Biome
  try {
    projectRequire.resolve("biome");
    cachedFormatCommand = 'biome format "{{file}}" --write --log-level none';
    return cachedFormatCommand;
  } catch (_error) {
    // Biome not found, continue
  }

  // Try ESLint
  try {
    projectRequire.resolve("eslint");
    cachedFormatCommand = 'eslint --fix "{{file}}" --quiet';
    return cachedFormatCommand;
  } catch (_error) {
    // ESLint not found
  }

  // No formatter found
  // Set to undefined (not null) so we know we checked and found nothing.
  cachedFormatCommand = undefined;
  return undefined;
};
