/**
 * Veo 3 Model Adapter
 * Implementation for Google Veo 3 (low and high quality)
 * Implements FR-005, FR-017, FR-020
 */

import axios from 'axios';
import crypto from 'crypto';
import { BaseModelAdapter, registerAdapterFactory } from '../modelAdapter.js';
import type { CompiledPrompt, GenerationResult, WebhookPayload, ModelCapability, ModelCapabilities } from '../../shared/types.js';

// Veo 3 API endpoint configuration
const VEO_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_WEBHOOK_SECRET = process.env.VEO_WEBHOOK_SECRET || 'veo-webhook-secret';

interface VeoConfig {
  apiKey: string;
  projectId?: string;
  region?: string;
}

interface VeoDispatchResponse {
  name: string; // Operation name for polling
  metadata: {
    createTime: string;
    updateTime: string;
  };
}

interface VeoOperation {
  name: string;
  done: boolean;
  response?: {
    videos: Array<{
      uri: string;
      mimeType: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

export class Veo3Adapter extends BaseModelAdapter {
  readonly modelId: string;
  readonly provider = 'google';
  private config: VeoConfig;
  private httpClient: ReturnType<typeof axios.create>;

  constructor(modelId: string, config: VeoConfig) {
    super();
    this.modelId = modelId;
    this.config = config;
    this.httpClient = axios.create({
      baseURL: VEO_API_BASE,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5 min timeout for API calls
    });
  }

  protected async makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    const requestBody = this.buildVeoRequest(prompt);

    const response = await this.httpClient.post<VeoDispatchResponse>(
      `/models/${this.modelId}:generateVideo`,
      requestBody
    );

    // Veo returns an operation name for polling
    return {
      providerRequestId: response.data.name,
      estimatedCompletionMs: this.getDefaultTimeoutSeconds() * 1000,
    };
  }

  protected async makeStatusCheck(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }> {
    const response = await this.httpClient.get<VeoOperation>(`/operations/${providerRequestId}`);

    if (response.data.done) {
      if (response.data.error) {
        return { status: 'failed', error: response.data.error.message };
      }

      if (response.data.response?.videos?.[0]) {
        const video = response.data.response.videos[0];
        return {
          status: 'completed',
          result: {
            shotId: '', // Filled by caller
            videoUrl: video.uri,
            durationSeconds: this.getMaxDurationSeconds(),
            actualCost: this.getCostPerSecond() * this.getMaxDurationSeconds(),
            modelId: this.modelId,
            providerMetadata: { uri: video.uri, mimeType: video.mimeType },
            nativeAudioUrl: undefined,
          },
        };
      }

      return { status: 'failed', error: 'No video generated' };
    }

    return { status: 'processing' };
  }

  protected async makeCancelRequest(providerRequestId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`/operations/${providerRequestId}`);
      return true;
    } catch {
      return false;
    }
  }

  protected verifySignature(payload: WebhookPayload): boolean {
    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', VEO_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(payload.signature),
      Buffer.from(expectedSignature)
    );
  }

  protected parseWebhookPayload(payload: WebhookPayload): GenerationResult | null {
    if (!payload.result) return null;

    return {
      shotId: '', // Filled by caller
      videoUrl: payload.result.videoUrl || '',
      durationSeconds: payload.result.durationSeconds || this.getMaxDurationSeconds(),
      actualCost: payload.result.actualCost || this.getCostPerSecond() * this.getMaxDurationSeconds(),
      modelId: this.modelId,
      providerMetadata: payload.result.providerMetadata || {},
      nativeAudioUrl: payload.result.nativeAudioUrl,
    };
  }

  getDefaultTimeoutSeconds(): number {
    // Veo 3 low: 120s, high: 180s
    return this.modelId.includes('low') ? 120 : 180;
  }

  getCostPerSecond(): number {
    // Veo 3 low quality: $0, high quality: ~$0.05/s
    return this.modelId.includes('low') ? 0 : 0.05;
  }

  supportsCapability(capability: string): boolean {
    const capabilities: ModelCapability[] = [
      'text_to_video',
      'image_to_video',
      'reference_conditioning',
    ];

    // High quality supports native audio
    if (this.modelId.includes('high')) {
      capabilities.push('native_audio', 'high_fidelity');
    } else {
      capabilities.push('fast_generation');
    }

    return capabilities.includes(capability as ModelCapability);
  }

  getMaxDurationSeconds(): number {
    return 10; // Veo 3 max ~10 seconds
  }

  getSupportedResolutions(): string[] {
    return this.modelId.includes('high') ? ['720p', '1080p', '4K'] : ['720p', '1080p'];
  }

  getSupportedAspectRatios(): string[] {
    return ['16:9', '9:16', '1:1', '4:5'];
  }

  private buildVeoRequest(prompt: CompiledPrompt): any {
    const request: any = {
      prompt: prompt.prompt,
      negativePrompt: prompt.negativePrompt,
      aspectRatio: prompt.modelParams.aspectRatio || '16:9',
      resolution: prompt.modelParams.resolution || '1080p',
      durationSeconds: prompt.modelParams.durationSeconds || 8,
    };

    // Add character conditioning for reference images
    if (prompt.characterConditioning.length > 0) {
      request.imageConditioning = prompt.characterConditioning.map((c: { referenceImageBase64: string; modelSpecificParams: any }) => ({
        image: c.referenceImageBase64,
        modelSpecificParams: c.modelSpecificParams,
      }));
    }

    // Add style references
    if (prompt.styleReferences.length > 0) {
      request.styleReferences = prompt.styleReferences;
    }

    return request;
  }
}

/**
 * Factory for creating Veo 3 adapters
 */
registerAdapterFactory('google', {
  createAdapter(modelId: string, config: Record<string, any>) {
    return new Veo3Adapter(modelId, {
      apiKey: config.apiKey,
      projectId: config.projectId,
      region: config.region || 'us-central1',
    });
  },
});