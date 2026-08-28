import { createExtensionRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";

/**
 * An intentionally closed PI resource loader.
 *
 * No user-global or repository extension, skill, prompt, theme, or AGENTS file is
 * discovered here. NoNeedWork adds approved resources explicitly at its own
 * boundary instead of executing ambient PI configuration in the host process.
 */
export function createBundledResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
