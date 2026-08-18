/**
 * Veo 3 Model Adapter
 * Implementation for Google Veo 3 (low and high quality)
 * Implements FR-005, FR-017, FR-020
 */

import axios from 'axios';
import crypto from 'crypto';
import { BaseModelAdapter, registerAdapterFactory } from '../modelAdapter.js';
import type { CompiledPrompt, GenerationResult, WebhookPayload, ModelCapability } from '../../shared/types.js';

// Veo 3 API endpoint configuration
const VEO_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_WEBHOOK_SECRET = process.env.VEO_WEBHOOK_SECRET || 'veo-webhook-secret';

// Map internal model IDs to live Gemini API model names.
// (veo-3.0-generate-001 was retired 2026-06-30; 3.1 is current GA.)
const VEO_API_MODEL_MAP: Record<string, string> = {
  'veo3-high': 'veo-3.1-generate-001',
  'veo3-low': 'veo-3.1-fast-generate-001',
};

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

interface VeoVideo {
  video?: { uri?: string };
  uri?: string;
  gcsUri?: string;
  mimeType?: string;
}

interface VeoGenerateVideoResponse {
  videos?: VeoVideo[];
  generatedVideos?: VeoVideo[];
  generateVideoResponse?: { generatedSamples?: VeoVideo[] };
}

interface VeoOperation {
  name: string;
  done: boolean;
  response?: VeoGenerateVideoResponse;
  error?: {
    code: number;
    message: string;
  };
}

interface VeoGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  generationConfig: {
    aspectRatio: string;
    durationSeconds: number;
    resolution: string;
  };
  image?: { bytesBase64Encoded: string; mimeType: string };
  styleReferences?: unknown[];
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
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5 min timeout for API calls
    });
  }

  protected async makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    const requestBody = this.buildVeoRequest(prompt);
    const apiModel = VEO_API_MODEL_MAP[this.modelId] || this.modelId;

    const response = await this.httpClient.post<VeoDispatchResponse>(
      `/models/${apiModel}:generateVideo`,
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

      // Gemini returns the video under response.videos[0].video.uri (or variants).
      const resp = response.data.response ?? {};
      const videosArr = resp.videos ?? resp.generatedVideos ?? resp.generateVideoResponse?.generatedSamples;
      const video = videosArr?.[0];
      let videoUrl = video?.video?.uri || video?.uri || video?.gcsUri;

      if (videoUrl) {
        // Gemini file URIs require the API key for authenticated download.
        if (videoUrl.includes('generativelanguage.googleapis.com')) {
          videoUrl = `${videoUrl}${videoUrl.includes('?') ? '&' : '?'}key=${this.config.apiKey}`;
        }
        return {
          status: 'completed',
          result: {
            shotId: '', // Filled by caller
            videoUrl,
            durationSeconds: this.getMaxDurationSeconds(),
            actualCost: this.getCostPerSecond() * this.getMaxDurationSeconds(),
            modelId: this.modelId,
            providerMetadata: { uri: videoUrl, mimeType: video?.mimeType },
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

  private buildVeoRequest(prompt: CompiledPrompt): VeoGenerateRequest {
    const request: VeoGenerateRequest = {
      prompt: prompt.prompt,
      negativePrompt: prompt.negativePrompt,
      generationConfig: {
        aspectRatio: (prompt.modelParams.aspectRatio as string) || '16:9',
        durationSeconds: (prompt.modelParams.durationSeconds as number) || 8,
        resolution: (prompt.modelParams.resolution as string) || '1080p',
      },
    };

    // Single reference image -> image-to-video (Gemini expects bytesBase64Encoded)
    if (prompt.characterConditioning.length > 0) {
      const first = prompt.characterConditioning[0];
      const base64 = String(first.referenceImageBase64 || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/, '');
      if (base64) {
        request.image = { bytesBase64Encoded: base64, mimeType: 'image/jpeg' };
      }
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