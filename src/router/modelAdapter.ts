/**
 * Model Adapter Interface
 * Implements FR-005, FR-017, FR-020
 * Pluggable interface for all model providers (Veo 3, Runway, Luma, etc.)
 */

import type { CompiledPrompt, GenerationResult, WebhookPayload } from '../shared/types.js';
import { config } from '../shared/config.js';

export interface ModelAdapter {
  /** Unique model identifier matching registry */
  readonly modelId: string;

  /** Provider name */
  readonly provider: string;

  /** Dispatch a generation request to the model provider
   * Returns provider's request ID for webhook correlation
   */
  dispatch(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }>;

  /** Check status of a previously dispatched request */
  checkStatus(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }>;

  /** Cancel a pending request if possible */
  cancel(providerRequestId: string): Promise<boolean>;

  /** Verify webhook payload authenticity (HMAC, signature) */
  verifyWebhook(payload: WebhookPayload): boolean;

  /** Parse webhook payload into normalized GenerationResult */
  parseWebhook(payload: WebhookPayload): GenerationResult | null;

  /** Get model-specific default timeout in seconds */
  getDefaultTimeoutSeconds(): number;

  /** Get model-specific cost per second (USD) */
  getCostPerSecond(): number;

  /** Check if model supports a capability */
  supportsCapability(capability: string): boolean;

  /** Get maximum duration this model can generate */
  getMaxDurationSeconds(): number;

  /** Get supported resolutions */
  getSupportedResolutions(): string[];

  /** Get supported aspect ratios */
  getSupportedAspectRatios(): string[];
}

/**
 * Base adapter class with common functionality
 */
export abstract class BaseModelAdapter implements ModelAdapter {
  abstract readonly modelId: string;
  abstract readonly provider: string;

  protected abstract makeDispatchRequest(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }>;
  protected abstract makeStatusCheck(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }>;
  protected abstract makeCancelRequest(providerRequestId: string): Promise<boolean>;
  protected abstract verifySignature(payload: WebhookPayload): boolean;
  protected abstract parseWebhookPayload(payload: WebhookPayload): GenerationResult | null;

  async dispatch(prompt: CompiledPrompt): Promise<{ providerRequestId: string; estimatedCompletionMs?: number }> {
    // Add model-specific parameters
    const enhancedPrompt = this.enhancePrompt(prompt);
    return this.makeDispatchRequest(enhancedPrompt);
  }

  async checkStatus(providerRequestId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string }> {
    return this.makeStatusCheck(providerRequestId);
  }

  async cancel(providerRequestId: string): Promise<boolean> {
    return this.makeCancelRequest(providerRequestId);
  }

  verifyWebhook(payload: WebhookPayload): boolean {
    return this.verifySignature(payload);
  }

  parseWebhook(payload: WebhookPayload): GenerationResult | null {
    return this.parseWebhookPayload(payload);
  }

  abstract getDefaultTimeoutSeconds(): number;
  abstract getCostPerSecond(): number;
  abstract supportsCapability(capability: string): boolean;
  abstract getMaxDurationSeconds(): number;
  abstract getSupportedResolutions(): string[];
  abstract getSupportedAspectRatios(): string[];

  /**
   * Add model-specific parameters to prompt
   * Override in subclasses for provider-specific formatting
   */
  protected enhancePrompt(prompt: CompiledPrompt): CompiledPrompt {
    return {
      ...prompt,
      modelParams: {
        ...prompt.modelParams,
        model_id: this.modelId,
      },
    };
  }
}

/**
 * Adapter Registry - manages all registered adapters
 */
class AdapterRegistry {
  private adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.modelId, adapter);
  }

  get(modelId: string): ModelAdapter | undefined {
    return this.adapters.get(modelId);
  }

  getAll(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }

  getByProvider(provider: string): ModelAdapter[] {
    return this.getAll().filter(a => a.provider === provider);
  }

  has(modelId: string): boolean {
    return this.adapters.has(modelId);
  }

  clear(): void {
    this.adapters.clear();
  }
}

export const adapterRegistry = new AdapterRegistry();

/**
 * Register an adapter (called during initialization)
 */
export function registerAdapter(adapter: ModelAdapter): void {
  adapterRegistry.register(adapter);
}

/**
 * Get adapter for a model
 */
export function getAdapter(modelId: string): ModelAdapter | undefined {
  return adapterRegistry.get(modelId);
}

/**
 * Clear all registered adapters (for testing)
 */
export function clearAdapters(): void {
  adapterRegistry.clear();
}

/**
 * Get all registered adapters
 */
export function getAllAdapters(): ModelAdapter[] {
  return adapterRegistry.getAll();
}

/**
 * Adapter Factory - creates adapters from configuration
 */
export interface AdapterFactory {
  createAdapter(modelId: string, config: Record<string, any>): ModelAdapter;
}

export const adapterFactories = new Map<string, AdapterFactory>();

export function registerAdapterFactory(provider: string, factory: AdapterFactory): void {
  adapterFactories.set(provider, factory);
}

export function getAdapterFactory(provider: string): AdapterFactory | undefined {
  return adapterFactories.get(provider);
}

/**
 * Initialize all adapters from model registry
 */
export async function initializeAdapters(): Promise<void> {
  // Ensure adapter factory side-effects are registered.
  // Each adapter file calls registerAdapterFactory() at module load.
  await import('./adapters/veo3Adapter.js');
  await import('./adapters/runwayAdapter.js');
  await import('./adapters/kieAdapter.js');

  const { getModelRegistry } = await import('./modelRegistry.js');
  const models = await getModelRegistry();

  for (const model of models) {
    const factory = getAdapterFactory(model.provider);
    if (factory) {
      try {
        // Model-specific config would come from secure config
        const adapterConfig = getAdapterConfig(model.provider);
        const adapter = factory.createAdapter(model.id, adapterConfig);
        registerAdapter(adapter);
        console.log(`Registered adapter: ${model.id} (${model.provider})`);
      } catch (error) {
        console.error(`Failed to create adapter for ${model.id}:`, error);
      }
    } else {
      console.warn(`No adapter factory for provider: ${model.provider}`);
    }
  }
}

function getAdapterConfig(provider: string): Record<string, any> {
  // Load API keys from config (populated from secret files via getSecret),
  // falling back to plain environment variables.
  const cfg = config;
  const configs: Record<string, Record<string, any>> = {
    google: { apiKey: cfg.veoApiKey || process.env.VEO_API_KEY, projectId: process.env.GCP_PROJECT_ID },
    runway: { apiKey: cfg.runwayApiKey || process.env.RUNWAY_API_KEY },
    luma: { apiKey: cfg.lumaApiKey || process.env.LUMA_API_KEY },
    kie: { apiKey: cfg.kieApiKey || process.env.KIE_API_KEY, callbackUrl: process.env.KIE_CALLBACK_URL },
  };
  return configs[provider] || {};
}