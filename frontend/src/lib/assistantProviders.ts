import type { AssistantConfig, AssistantConfigPatch } from "./assistant";

// Official OpenAI-compatible endpoints with a standard, authenticated /models catalog.
export const assistantProviders = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  {
    id: "kimi",
    name: "Kimi · 中国内地",
    baseUrl: "https://api.moonshot.cn/v1",
  },
] as const;

export function normalizeAssistantUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function providerForUrl(value: string) {
  return (
    assistantProviders.find(
      (provider) => provider.baseUrl === normalizeAssistantUrl(value),
    )?.id || "custom"
  );
}

export function canKeepAssistantKey(config: AssistantConfig, value: string) {
  return (
    config.source === "custom" &&
    config.has_hermes_api_key &&
    normalizeAssistantUrl(config.hermes_base_url) ===
      normalizeAssistantUrl(value)
  );
}

export function assistantConnectionPatch(
  baseUrl: string,
  apiKey: string,
): AssistantConfigPatch {
  const patch: AssistantConfigPatch = {
    hermes_base_url: normalizeAssistantUrl(baseUrl),
  };
  if (apiKey.trim()) patch.hermes_api_key = apiKey.trim();
  return patch;
}
