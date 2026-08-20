/**
 * Kie.ai Veo 3.1 Model Adapter
 * Implementation for Kie.ai Veo 3.1 API (Quality, Fast, Lite)
 * Implements FR-005, FR-017, FR-020
 */

import axios from 'axios';
import crypto from 'crypto';
import { BaseModelAdapter, registerAdapterFactory } from '../modelAdapter.js';
import type { CompiledPrompt, GenerationResult, WebhookPayload, ModelCapability } from '../../shared/types.js';

// Kie.ai API endpoint configuration
const KIE_API_BASE = 'https://api.kie.ai';
const KIE_WEBHOOK_SECRET = process.env.KIE_WEBHOOK_SECRET || 'kie-webhook-secret';

// Map internal model IDs to kie.ai model names
const KIE_API_MODEL_MAP: Record<string, string> = {
  'veo3-high': 'veo3',       // Veo 3.1 Quality
  'veo3-low': 'veo3_fast',   // Veo 3.1 Fast
  'veo3-lite': 'veo3_lite',  // Veo 3.1 Lite
};

interface KieConfig {
  apiKey: string;
  callbackUrl?: string;
}

interface KieDispatchResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

interface KieStatusResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    paramJson: string;
    completeTime: number;
    response: {
      taskId: string;
      resultUrls: string[];
      fullResultUrls?: string[];
      originUrls?: string[];
      resolution?: string;
    };
    successFlag: number; // 0=generating, 1=success, 2=failed, 3=generation failed
    fallbackFlag?: boolean;
  };
}

// Kie.ai webhook callback metadata structure (stored in providerMetadata)
interface KieWebhookMetadata {
  taskId: string;
  fallbackFlag?: boolean;
  info: {
    resultUrls: string[];
    originUrls?: string[];
    resolution?: string;
  };
}

interface KieGenerateRequest {
  prompt: string;
  imageUrls?: string[];
  model: string;
  generationType?: 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' | 'REFERENCE_2_VIDEO';
  aspect_ratio?: '16:9' | '9:16' | 'Auto';
  callBackUrl?: string;
  enableFallback?: boolean;
  enableTranslation?: boolean;
  waterMark?: string;
  seed?: number;
}

export class KieAdapter extends BaseModelAdapter {
  readonly modelId: string;
  readonly provider = 'kie';
  private config: KieConfig;
  private httpClient: ReturnType<typeof axios.create>;
  private cachedCredits: { amount: number; checkedAt: number } | null = null;

  constructor(modelId: string, config: KieConfig) {
    super();
    this.modelId = modelId;
    this.config = config;
    this.httpClient = this.createHttpClient(config.apiKey);
  }

  private createHttpClient(apiKey: string): ReturnType<typeof axios.create> {
    return axios.create({
      baseURL: KIE_API_BASE,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300000,
    });
  }

  /**
   * Update the API key and recreate httpClient.
   * Call this when the API key is rotated.
   */
  updateApiKey(newApiKey: string): void {
    this.config.apiKey = newApiKey;
    this.httpClient = this.createHttpClient(newApiKey);
    this.invalidateCreditCache();
    console.log(`[KIE DEBUG] API key updated for ${this.modelId}`);
  }

  /**
   * Invalidate the credit cache to force a fresh check on next call.
   */
  invalidateCreditCache(): void {
    this.cachedCredits = null;
    console.log(`[KIE DEBUG] Credit cache invalidated for ${this.modelId}`);
  }

  /**
   * Check KIE credit balance. Cached for 60s to avoid unnecessary API calls.
   * Returns null if check fails (don't block dispatch on check failure).
   */
  async checkCredits(): Promise<number | null> {
    try {
      // Reuse cached result if <60s old
      if (this.cachedCredits && (Date.now() - this.cachedCredits.checkedAt) < 60000) {
        console.log(`[KIE DEBUG] Using cached credits: ${this.cachedCredits.amount}`);
        return this.cachedCredits.amount;
      }
      console.log(`[KIE DEBUG] Checking credits via API for ${this.modelId}...`);
      const response = await this.httpClient.get<{ code: number; data: number }>('/api/v1/chat/credit');
      console.log(`[KIE DEBUG] Credit check response:`, response.data);
      if (response.data.code === 200) {
        this.cachedCredits = { amount: response.data.data, checkedAt: Date.now() };
        console.log(`[KIE DEBUG] Credits updated: ${response.data.data}`);
        return response.data.data;
      }
      console.warn(`[KIE DEBUG] Credit check returned non-200: ${response.data.code}`);
      return null;
    } catch (error: any) {
      console.error(`[KIE DEBUG] Credit check failed:`, error.message);
      return null;
    }
  }

  /**
   * Check if there are enough credits for one shot.
   * KIE charges ~60 credits per 8s video on veo3_fast.
   */
  async hasEnoughCreditsForOneShot(forceFreshCheck = false): Promise<boolean> {
    const credits = forceFreshCheck ? await this.checkCreditsFresh() : await this.checkCredits();
    if (credits === null) return true; // Don't block on check failure
    return credits >= 10; // Minimum threshold — even lite needs a few credits
  }

  /**
   * Force a fresh credit check, bypassing cache.
   */
  async checkCreditsFresh(): Promise<number | null> {
    this.invalidateCreditCache();
    return this.checkCredits();
  }

  protected async makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    // Credit guard — fail fast before burning API call
    const hasCredits = await this.hasEnoughCreditsForOneShot();
    if (!hasCredits) {
      throw new Error('Kie.ai credits insufficient — dispatch blocked to prevent credit waste');
    }

    const requestBody = this.buildKieRequest(prompt);
    console.log('[KIE DEBUG] Dispatch request:', JSON.stringify(requestBody, null, 2));

    const response = await this.httpClient.post<KieDispatchResponse>(
      '/api/v1/veo/generate',
      requestBody
    );

    console.log('[KIE DEBUG] Dispatch response:', JSON.stringify(response.data, null, 2));

    if (response.data.code !== 200) {
      throw new Error(`Kie.ai generation failed: ${response.data.msg}`);
    }

    return {
      providerRequestId: response.data.data.taskId,
      estimatedCompletionMs: this.getDefaultTimeoutSeconds() * 1000,
    };
  }

  protected async makeStatusCheck(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }> {
    const response = await this.httpClient.get<KieStatusResponse>(
      `/api/v1/veo/record-info?taskId=${providerRequestId}`
    );

    if (response.data.code !== 200) {
      return { status: 'failed', error: `Kie.ai status check failed: ${response.data.msg}` };
    }

    const data = response.data.data;
    const successFlag = data.successFlag;

    if (successFlag === 1) {
      // Success - video generated
      const videoUrl = data.response.resultUrls?.[0];
      if (!videoUrl) {
        return { status: 'failed', error: 'No video URL returned' };
      }

      return {
        status: 'completed',
        result: {
          shotId: '',
          videoUrl,
          durationSeconds: this.getMaxDurationSeconds(),
          actualCost: this.getCostPerSecond() * this.getMaxDurationSeconds(),
          modelId: this.modelId,
          providerMetadata: {
            taskId: providerRequestId,
            fallbackFlag: data.fallbackFlag,
            info: {
              resultUrls: data.response.resultUrls,
              originUrls: data.response.originUrls,
              resolution: data.response.resolution,
            },
          },
          nativeAudioUrl: undefined,
        },
      };
    }

    if (successFlag === 2 || successFlag === 3) {
      return { status: 'failed', error: 'Video generation failed' };
    }

    // successFlag === 0: still generating
    return { status: 'processing' };
  }

  protected async makeCancelRequest(_providerRequestId: string): Promise<boolean> {
    // Kie.ai doesn't support cancellation via API
    await Promise.resolve();
    return false;
  }

  protected verifySignature(payload: WebhookPayload): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', KIE_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(payload.signature),
      Buffer.from(expectedSignature)
    );
  }

  protected parseWebhookPayload(payload: WebhookPayload): GenerationResult | null {
    if (!payload.result) return null;

    // Kie.ai callback stores extra data in providerMetadata
    const meta = payload.result.providerMetadata as unknown as KieWebhookMetadata | undefined;
    if (!meta || !meta.info) return null;

    const videoUrl = meta.info.resultUrls?.[0];
    if (!videoUrl) return null;

    return {
      shotId: '',
      videoUrl,
      durationSeconds: payload.result.durationSeconds || this.getMaxDurationSeconds(),
      actualCost: payload.result.actualCost || this.getCostPerSecond() * this.getMaxDurationSeconds(),
      modelId: this.modelId,
      providerMetadata: {
        taskId: meta.taskId,
        fallbackFlag: meta.fallbackFlag,
        originUrls: meta.info.originUrls,
      },
      nativeAudioUrl: payload.result.nativeAudioUrl,
    };
  }

  getDefaultTimeoutSeconds(): number {
    // Kie.ai typical generation time: 2-5 minutes, allow 10 for safety
    return 600;
  }

  getCostPerSecond(): number {
    // Kie.ai pricing is per-video, not per-second. Approximate for cost guard.
    // Veo3 Fast: ~$0.10/video, Quality: ~$0.40/video, Lite: ~$0.05/video
    // Assuming 10s video for per-second calculation
    if (this.modelId.includes('lite')) return 0.005;
    if (this.modelId.includes('fast')) return 0.01;
    return 0.04;
  }

  supportsCapability(capability: string): boolean {
    const capabilities: ModelCapability[] = [
      'text_to_video',
      'image_to_video',
      'reference_conditioning',
    ];

    // Quality model supports more features
    if (this.modelId.includes('quality')) {
      capabilities.push('native_audio', 'high_fidelity');
    } else {
      capabilities.push('fast_generation', 'native_audio');
    }

    // Lite model limitations
    if (this.modelId.includes('lite')) {
      // Lite supports reference conditioning but only 16:9/9:16
    }

    return capabilities.includes(capability as ModelCapability);
  }

  getMaxDurationSeconds(): number {
    return 8; // Kie.ai Veo 3.1 max ~8 seconds per clip
  }

  getSupportedResolutions(): string[] {
    return this.modelId.includes('quality') ? ['720p', '1080p', '4K'] : ['720p', '1080p'];
  }

  getSupportedAspectRatios(): string[] {
    return ['16:9', '9:16'];
  }

  private buildKieRequest(prompt: CompiledPrompt): KieGenerateRequest {
    const apiModel = KIE_API_MODEL_MAP[this.modelId] || 'veo3_fast';
    const aspectRatio = (prompt.modelParams.aspectRatio as string) || '16:9';
    const validAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';

    const request: KieGenerateRequest = {
      prompt: prompt.prompt,
      model: apiModel,
      aspect_ratio: validAspectRatio,
      generationType: 'TEXT_2_VIDEO',
    };

    // Add callback URL if configured
    if (this.config.callbackUrl) {
      request.callBackUrl = this.config.callbackUrl;
    }

    // Enable fallback for quality model (16:9 only)
    if (this.modelId.includes('high')) {
      request.enableFallback = true;
    }

    // Single reference image -> image-to-video
    if (prompt.characterConditioning.length > 0) {
      const first = prompt.characterConditioning[0];
      const imageUrl = String(first.referenceImageBase64 || '');
      if (imageUrl) {
        request.generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
        request.imageUrls = [imageUrl];
      }
    }

    // Add style references as additional images for REFERENCE_2_VIDEO
    if (prompt.styleReferences.length > 0) {
      request.generationType = 'REFERENCE_2_VIDEO';
      request.imageUrls = [...(request.imageUrls || []), ...prompt.styleReferences];
    }

    return request;
  }
}

/**
 * Factory for creating Kie.ai adapters
 */
registerAdapterFactory('kie', {
  createAdapter(modelId: string, config: { apiKey?: string; callbackUrl?: string }) {
    return new KieAdapter(modelId, {
      apiKey: config.apiKey ?? '',
      callbackUrl: config.callbackUrl,
    });
  },
});