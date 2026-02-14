import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installSkills,
  type Platform,
  SKILLS,
  SKILLS_METADATA,
  type Skill,
} from '@intlayer/chokidar';
import { type QuickPickItem, window } from 'vscode';
import { findProjectRoot } from '../utils/findProjectRoot';

interface QuickPickItemWithValue<T> extends QuickPickItem {
  value: T;
}

export const initSkills = async () => {
  const root = findProjectRoot();

  if (!root) {
    window.showErrorMessage('Could not find project root.');
    return;
  }

  const PLATFORM_OPTIONS: { value: Platform; label: string; hint: string }[] = [
    { value: 'Cursor' as Platform, label: 'Cursor', hint: '(.cursor/skills)' },
    {
      value: 'Windsurf' as Platform,
      label: 'Windsurf',
      hint: '(.windsurf/skills)',
    },
    { value: 'Trae' as Platform, label: 'Trae', hint: '(.trae/skills)' },
    { value: 'TraeCN' as Platform, label: 'Trae CN', hint: '(.trae/skills)' },
    { value: 'VSCode' as Platform, label: 'VS Code', hint: '(.github/skills)' },
    {
      value: 'OpenCode' as Platform,
      label: 'OpenCode',
      hint: '(.opencode/skills)',
    },
    {
      value: 'Claude' as Platform,
      label: 'Claude Code',
      hint: '(.claude/skills)',
    },
    {
      value: 'GitHub' as Platform,
      label: 'GitHub Copilot Workspace',
      hint: '(.github/skills)',
    },
    {
      value: 'Antigravity' as Platform,
      label: 'Antigravity',
      hint: '(.agent/skills)',
    },
    {
      value: 'Augment' as Platform,
      label: 'Augment',
      hint: '(.augment/skills)',
    },
    { value: 'OpenClaw' as Platform, label: 'OpenClaw', hint: '(skills)' },
    { value: 'Cline' as Platform, label: 'Cline', hint: '(.cline/skills)' },
    {
      value: 'CodeBuddy' as Platform,
      label: 'CodeBuddy',
      hint: '(.codebuddy/skills)',
    },
    {
      value: 'CommandCode' as Platform,
      label: 'Command Code',
      hint: '(.commandcode/skills)',
    },
    {
      value: 'Continue' as Platform,
      label: 'Continue',
      hint: '(.continue/skills)',
    },
    { value: 'Crush' as Platform, label: 'Crush', hint: '(.crush/skills)' },
    { value: 'Droid' as Platform, label: 'Droid', hint: '(.factory/skills)' },
    { value: 'Goose' as Platform, label: 'Goose', hint: '(.goose/skills)' },
    { value: 'IFlow' as Platform, label: 'iFlow CLI', hint: '(.iflow/skills)' },
    { value: 'Junie' as Platform, label: 'Junie', hint: '(.junie/skills)' },
    {
      value: 'KiloCode' as Platform,
      label: 'Kilo Code',
      hint: '(.kilocode/skills)',
    },
    { value: 'Kiro' as Platform, label: 'Kiro CLI', hint: '(.kiro/skills)' },
    { value: 'Kode' as Platform, label: 'Kode', hint: '(.kode/skills)' },
    { value: 'MCPJam' as Platform, label: 'MCPJam', hint: '(.mcpjam/skills)' },
    {
      value: 'MistralVibe' as Platform,
      label: 'Mistral Vibe',
      hint: '(.vibe/skills)',
    },
    { value: 'Mux' as Platform, label: 'Mux', hint: '(.mux/skills)' },
    {
      value: 'OpenHands' as Platform,
      label: 'OpenHands',
      hint: '(.openhands/skills)',
    },
    { value: 'Pi' as Platform, label: 'Pi', hint: '(.pi/skills)' },
    { value: 'Qoder' as Platform, label: 'Qoder', hint: '(.qoder/skills)' },
    { value: 'Qwen' as Platform, label: 'Qwen Code', hint: '(.qwen/skills)' },
    { value: 'RooCode' as Platform, label: 'Roo Code', hint: '(.roo/skills)' },
    {
      value: 'Zencoder' as Platform,
      label: 'Zencoder',
      hint: '(.zencoder/skills)',
    },
    {
      value: 'Neovate' as Platform,
      label: 'Neovate',
      hint: '(.neovate/skills)',
    },
    { value: 'Pochi' as Platform, label: 'Pochi', hint: '(.pochi/skills)' },
    { value: 'Other' as Platform, label: 'Other', hint: '(skills)' },
  ];

  const selectedPlatforms = await window.showQuickPick<
    QuickPickItemWithValue<Platform>
  >(
    PLATFORM_OPTIONS.map((p) => ({
      label: p.label,
      detail: p.hint,
      value: p.value,
      picked: p.value === 'VSCode',
    })),
    {
      placeHolder: 'Which platforms are you using?',
      canPickMany: true,
    }
  );

  if (!selectedPlatforms || selectedPlatforms.length === 0) {
    return;
  }

  // Detect framework skills
  let dependencies: Record<string, string> = {};
  try {
    const packageJsonPath = join(root, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
    }
  } catch {
    // Ignore errors reading package.json
  }

  const initialValues: Skill[] = [
    'Usage',
    'Config',
    'Content',
    'RemoteContent',
  ];

  if (dependencies.react || dependencies.next) {
    initialValues.push('React');
  }
  if (dependencies.next) {
    initialValues.push('NextJS');
  }
  if (dependencies.preact) {
    initialValues.push('Preact' as Skill);
  }
  if (dependencies['solid-js']) {
    initialValues.push('Solid' as Skill);
  }
  if (dependencies.vue || dependencies.nuxt) {
    initialValues.push('Vue');
  }
  if (dependencies.svelte || dependencies['@sveltejs/kit']) {
    initialValues.push('Svelte');
  }
  if (dependencies.astro) {
    initialValues.push('Astro');
  }

  const selectedSkills = await window.showQuickPick<
    QuickPickItemWithValue<Skill>
  >(
    SKILLS.map((skill: Skill) => ({
      label: skill,
      detail: SKILLS_METADATA[skill],
      value: skill,
      picked: initialValues.includes(skill),
    })),
    {
      placeHolder: 'Select the documentation skills to provide to your AI',
      canPickMany: true,
    }
  );

  if (!selectedSkills || selectedSkills.length === 0) {
    return;
  }

  // Call installSkills for each platform
  await window.withProgress(
    {
      location: 15, // Notification
      title: 'Installing Intlayer skills...',
      cancellable: false,
    },
    async (progress) => {
      try {
        const results: string[] = [];
        for (const platform of selectedPlatforms) {
          const result = await installSkills(
            root,
            platform.value,
            selectedSkills.map((s) => s.value)
          );
          results.push(result);
        }

        window.showInformationMessage(
          `Skills installed successfully: ${results.join(', ')}`
        );
      } catch (error) {
        window.showErrorMessage(`Failed to install skills: ${String(error)}`);
      }
    }
  );
};
