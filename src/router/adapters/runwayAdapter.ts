/**
 * Runway Gen-3 Adapter
 * Implementation for Runway Gen-3 Alpha
 * Implements FR-005, FR-017, FR-020
 */

import axios from 'axios';
import crypto from 'crypto';
import { BaseModelAdapter, registerAdapterFactory } from '../modelAdapter.js';
import type { CompiledPrompt, GenerationResult, WebhookPayload, ModelCapability } from '../../shared/types.js';

const RUNWAY_API_BASE = 'https://api.runwayml.com/v1';
const RUNWAY_WEBHOOK_SECRET = process.env.RUNWAY_WEBHOOK_SECRET || 'runway-webhook-secret';

interface RunwayConfig {
  apiKey: string;
  teamId?: string;
}

interface RunwayTaskResponse {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  output?: {
    video_url: string;
    duration: number;
  };
  error?: string;
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
      },
      timeout: 300000,
    });
  }

  protected async makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    const requestBody = this.buildRunwayRequest(prompt);

    const response = await this.httpClient.post<RunwayTaskResponse>(
      '/tasks',
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
        if (response.data.output?.video_url) {
          return {
            status: 'completed',
            result: {
              shotId: '',
              videoUrl: response.data.output.video_url,
              durationSeconds: response.data.output.duration || this.getMaxDurationSeconds(),
              actualCost: this.getCostPerSecond() * (response.data.output.duration || this.getMaxDurationSeconds()),
              modelId: this.modelId,
              providerMetadata: { taskId: providerRequestId },
            },
          };
        }
        return { status: 'failed', error: 'No output video' };

      case 'FAILED':
        return { status: 'failed', error: response.data.error || 'Generation failed' };

      case 'PENDING':
      case 'RUNNING':
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

  private buildRunwayRequest(prompt: CompiledPrompt): any {
    const request: any = {
      model: 'gen3a_turbo',
      prompt: prompt.prompt,
      negative_prompt: prompt.negativePrompt,
      aspect_ratio: prompt.modelParams.aspectRatio || '16:9',
      duration: prompt.modelParams.durationSeconds || 10,
    };

    // Runway Gen-3 only supports a single reference image
    // For multi-character shots, use primary character (first in characterConditioning array)
    // Log warning for visibility; future enhancement: composite image
    if (prompt.characterConditioning.length > 0) {
      if (prompt.characterConditioning.length > 1) {
        console.warn(
          `[RunwayAdapter] Multi-character Face-Lock: Using primary character ` +
          `"${prompt.characterConditioning[0].characterName}" for shot. ` +
          `Additional characters (${prompt.characterConditioning.slice(1).map((c: { characterName: string }) => c.characterName).join(', ')}) ` +
          `not included in Runway request (single-image limitation).`
        );
      }
      request.image = prompt.characterConditioning[0].referenceImageBase64;
    }

    return request;
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