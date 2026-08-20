/**
 * LLM Provider Abstraction
 * Allows swapping between Gemini, NVIDIA NIM, and future providers
 */

export type LLMProviderName = 'gemini' | 'nvidia';

export interface ChatChunk {
  token?: string;
  action?: {
    type: string;
    shotId?: string;
    field?: string;
    before?: string;
    after?: string;
  };
  complete?: boolean;
  error?: string;
  summary?: any;
}

export interface LLMProvider {
  name: LLMProviderName;
  streamChat(
    systemPrompt: string,
    userMessage: string,
    temperature: number
  ): AsyncGenerator<ChatChunk, void, unknown>;
}

export interface LLMProviderConfig {
  geminiApiKey?: string;
  nvidiaApiKey?: string;
  geminiModel?: string;
  nvidiaModel?: string;
}

export function getAvailableProviders(config: LLMProviderConfig): LLMProviderName[] {
  const providers: LLMProviderName[] = [];
  if (config.geminiApiKey) providers.push('gemini');
  if (config.nvidiaApiKey) providers.push('nvidia');
  return providers;
}
