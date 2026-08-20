/**
 * Google Gemini LLM Provider
 * Uses @google/generative-ai SDK for streaming chat
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, ChatChunk } from './llmProvider.js';

export class GeminiProvider implements LLMProvider {
  name = 'gemini' as const;
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.0-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async *streamChat(
    systemPrompt: string,
    userMessage: string,
    temperature: number
  ): AsyncGenerator<ChatChunk, void, unknown> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: { temperature }
    });

    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I am ready to co-work on this video project.' }] }
      ]
    });

    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const token = chunk.text();
      if (!token) continue;
      yield { token };
    }
  }
}
