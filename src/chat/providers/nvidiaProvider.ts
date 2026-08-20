/**
 * NVIDIA NIM LLM Provider
 * Uses OpenAI-compatible /v1/chat/completions endpoint
 * Endpoint: https://integrate.api.nvidia.com/v1
 */

import type { LLMProvider, ChatChunk } from './llmProvider.js';

const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';

interface NVIDIAChunk {
  id: string;
  choices: Array<{
    delta: { content?: string; role?: string };
    finish_reason: string | null;
  }>;
}

export class NvidiaProvider implements LLMProvider {
  name = 'nvidia' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'nvidia/nemotron-3-ultra-550b-a55b') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async *streamChat(
    systemPrompt: string,
    userMessage: string,
    temperature: number
  ): AsyncGenerator<ChatChunk, void, unknown> {
    const response = await fetch(`${NVIDIA_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 4096,
        temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`NVIDIA NIM API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed: NVIDIAChunk = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield { token: content };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
