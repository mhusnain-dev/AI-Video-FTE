/**
 * Runway Gen-3 Adapter
 * Implementation for Runway Gen-3 Alpha
 * Implements FR-005, FR-017, FR-020
 */

import axios from 'axios';
import crypto from 'crypto';
import { BaseModelAdapter, registerAdapterFactory } from '../modelAdapter.js';
import type { CompiledPrompt, GenerationResult, WebhookPayload, ModelCapability } from '../../shared/types.js';

const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_API_VERSION = '2024-11-06';
const RUNWAY_WEBHOOK_SECRET = process.env.RUNWAY_WEBHOOK_SECRET || 'runway-webhook-secret';

interface RunwayConfig {
  apiKey: string;
  teamId?: string;
}

interface RunwayTaskResponse {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'THROTTLED';
  output?: string[];
  failure?: string;
  error?: string;
}

interface RunwayGenerateRequest {
  model: string;
  promptText: string;
  ratio: string;
  duration: number;
  promptImage?: string;
}

export class RunwayAdapter extends BaseModelAdapter {
  readonly modelId: string;
  readonly provider = 'runway';
  private config: RunwayConfig;
  private httpClient: ReturnType<typeof axios.create>;

  constructor(modelId: string, config: RunwayConfig) {
    super();
    this.modelId = modelId;
    this.config = config;
    this.httpClient = axios.create({
      baseURL: RUNWAY_API_BASE,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': RUNWAY_API_VERSION,
      },
      timeout: 300000,
    });
  }

  protected async makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    const requestBody = this.buildRunwayRequest(prompt);
    const endpoint = requestBody.promptImage ? '/image_to_video' : '/text_to_video';

    const response = await this.httpClient.post<RunwayTaskResponse>(
      endpoint,
      requestBody
    );

    return {
      providerRequestId: response.data.id,
      estimatedCompletionMs: this.getDefaultTimeoutSeconds() * 1000,
    };
  }

  protected async makeStatusCheck(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }> {
    const response = await this.httpClient.get<RunwayTaskResponse>(`/tasks/${providerRequestId}`);

    switch (response.data.status) {
      case 'SUCCEEDED':
        if (response.data.output?.[0]) {
          return {
            status: 'completed',
            result: {
              shotId: '',
              videoUrl: response.data.output[0],
              durationSeconds: this.getMaxDurationSeconds(),
              actualCost: this.getCostPerSecond() * this.getMaxDurationSeconds(),
              modelId: this.modelId,
              providerMetadata: { taskId: providerRequestId },
            },
          };
        }
        return { status: 'failed', error: 'No output video' };

      case 'FAILED':
        return { status: 'failed', error: response.data.failure || response.data.error || 'Generation failed' };

      case 'PENDING':
      case 'PROCESSING':
      case 'RUNNING':
      case 'THROTTLED':
        return { status: 'processing' };

      default:
        return { status: 'processing' };
    }
  }

  protected async makeCancelRequest(providerRequestId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`/tasks/${providerRequestId}`);
      return true;
    } catch {
      return false;
    }
  }

  protected verifySignature(payload: WebhookPayload): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', RUNWAY_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(payload.signature),
      Buffer.from(expectedSignature)
    );
  }

  protected parseWebhookPayload(payload: WebhookPayload): GenerationResult | null {
    if (!payload.result?.videoUrl) return null;

    return {
      shotId: '',
      videoUrl: payload.result.videoUrl,
      durationSeconds: payload.result.durationSeconds || this.getMaxDurationSeconds(),
      actualCost: payload.result.actualCost || this.getCostPerSecond() * this.getMaxDurationSeconds(),
      modelId: this.modelId,
      providerMetadata: payload.result.providerMetadata || {},
    };
  }

  getDefaultTimeoutSeconds(): number {
    return 180; // Runway Gen-3 typically takes 2-3 minutes
  }

  getCostPerSecond(): number {
    return 0.08; // ~$0.08/second
  }

  supportsCapability(capability: string): boolean {
    const capabilities: ModelCapability[] = [
      'text_to_video',
      'image_to_video',
      'reference_conditioning',
    ];
    return capabilities.includes(capability as ModelCapability);
  }

  getMaxDurationSeconds(): number {
    return 10;
  }

  getSupportedResolutions(): string[] {
    return ['720p', '1080p'];
  }

  getSupportedAspectRatios(): string[] {
    return ['16:9', '9:16'];
  }

  private buildRunwayRequest(prompt: CompiledPrompt): RunwayGenerateRequest {
    const request: RunwayGenerateRequest = {
      model: 'gen4.5',
      promptText: prompt.prompt,
      ratio: this.mapAspectRatio((prompt.modelParams.aspectRatio as string) || '16:9'),
      duration: this.clampDuration((prompt.modelParams.durationSeconds as number) || 8),
    };

    // Runway accepts a single reference image (HTTPS URL, data URI, or runway:// URI)
    if (prompt.characterConditioning.length > 0) {
      if (prompt.characterConditioning.length > 1) {
        console.warn(
          `[RunwayAdapter] Multi-character Face-Lock: Using primary character ` +
          `"${prompt.characterConditioning[0].characterName}" for shot. ` +
          `Additional characters (${prompt.characterConditioning.slice(1).map((c: { characterName: string }) => c.characterName).join(', ')}) ` +
          `not included in Runway request (single-image limitation).`
        );
      }
      const img = String(prompt.characterConditioning[0].referenceImageBase64 || '');
      if (img) {
        request.promptImage = img.startsWith('data:') || img.startsWith('http')
          ? img
          : `data:image/jpeg;base64,${img}`;
      }
    }

    return request;
  }

  private mapAspectRatio(aspectRatio: string): string {
    const map: Record<string, string> = {
      '16:9': '1280:720',
      '9:16': '720:1280',
      '1:1': '960:960',
      '4:5': '832:1104',
    };
    return map[aspectRatio] || '1280:720';
  }

  private clampDuration(durationSeconds: number): number {
    // gen4.5 supports 5s or 10s
    return durationSeconds <= 5 ? 5 : 10;
  }
}

/**
 * Factory for creating Runway adapters
 */
registerAdapterFactory('runway', {
  createAdapter(modelId: string, config: Record<string, any>) {
    return new RunwayAdapter(modelId, {
      apiKey: config.apiKey,
      teamId: config.teamId,
    });
  },
});