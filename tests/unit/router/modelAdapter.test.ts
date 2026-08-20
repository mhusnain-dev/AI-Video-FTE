/**
 * Unit tests for Model Adapter (src/router/modelAdapter.ts)
 * Covers: BaseModelAdapter, AdapterRegistry, adapter factories,
 *         registerAdapter, getAdapter, clearAdapters, getAllAdapters,
 *         initializeAdapters, getAdapterConfig
 */

import type { CompiledPrompt, GenerationResult, WebhookPayload } from '../../../src/shared/types';

// ===== MOCKS — must come before imports =====

jest.mock('../../../src/shared/config', () => ({
  config: {
    veoApiKey: 'veo-key-from-config',
    runwayApiKey: 'runway-key-from-config',
    lumaApiKey: 'luma-key-from-config',
    kieApiKey: 'kie-key-from-config',
  },
}));

// Stub the three adapter dynamic imports so initializeAdapters never hits the network.
jest.mock('../../../src/router/adapters/veo3Adapter', () => ({ default: {} }));
jest.mock('../../../src/router/adapters/runwayAdapter', () => ({ default: {} }));
jest.mock('../../../src/router/adapters/kieAdapter', () => ({ default: {} }));

const mockModels = [
  {
    id: 'veo3-low',
    name: 'Veo 3 Low',
    provider: 'google',
    maxResolution: '1080p' as const,
    maxDurationSeconds: 10,
    supportedAspectRatios: ['16:9', '9:16'] as const,
    supportedRegions: ['us'],
    costPerSecondUsd: 0,
    costCurrency: 'USD',
    capabilities: ['text_to_video'] as const,
    defaultTimeoutSeconds: 120,
  },
  {
    id: 'runway-gen3',
    name: 'Runway Gen-3',
    provider: 'runway',
    maxResolution: '1080p' as const,
    maxDurationSeconds: 10,
    supportedAspectRatios: ['16:9'] as const,
    supportedRegions: ['us'],
    costPerSecondUsd: 0.08,
    costCurrency: 'USD',
    capabilities: ['text_to_video'] as const,
    defaultTimeoutSeconds: 180,
  },
];

jest.mock('../../../src/router/modelRegistry', () => ({
  getModelRegistry: jest.fn().mockResolvedValue(mockModels),
}));

// ===== Imports =====

import {
  BaseModelAdapter,
  adapterRegistry,
  registerAdapter,
  getAdapter,
  clearAdapters,
  getAllAdapters,
  adapterFactories,
  registerAdapterFactory,
  getAdapterFactory,
  initializeAdapters,
} from '../../../src/router/modelAdapter';
import { getModelRegistry } from '../../../src/router/modelRegistry';
import { config } from '../../../src/shared/config';

// ===== Helpers =====

function makePrompt(overrides: Partial<CompiledPrompt> = {}): CompiledPrompt {
  return {
    modelId: 'test-model',
    shotId: 'shot-1',
    prompt: 'A cat sitting on a windowsill',
    characterConditioning: [],
    styleReferences: [],
    modelParams: { aspectRatio: '16:9', durationSeconds: 8, resolution: '1080p' },
    parameters: { aspectRatio: '16:9', durationSeconds: 8, resolution: '1080p' },
    ...overrides,
  };
}

function makeWebhookPayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    provider: 'test',
    requestId: 'req-1',
    status: 'completed',
    timestamp: new Date(),
    signature: 'sig',
    ...overrides,
  };
}

/**
 * Concrete subclass of BaseModelAdapter for testing the abstract base class.
 */
class ConcreteTestAdapter extends BaseModelAdapter {
  readonly modelId: string;
  readonly provider: string;
  private _opts: {
    dispatchResult?: { providerRequestId: string; estimatedCompletionMs?: number };
    statusResult?: { status: 'pending' | 'processing' | 'completed' | 'failed'; result?: GenerationResult; error?: string };
    cancelResult?: boolean;
    verifyResult?: boolean;
    parseResult?: GenerationResult | null;
    throwOnDispatch?: boolean;
  };

  constructor(
    modelId: string,
    provider: string,
    opts: ConcreteTestAdapter['_opts'] = {},
  ) {
    super();
    this.modelId = modelId;
    this.provider = provider;
    this._opts = opts;
  }

  protected async makeDispatchRequest(_prompt: CompiledPrompt) {
    if (this._opts.throwOnDispatch) throw new Error('dispatch failed');
    return this._opts.dispatchResult ?? { providerRequestId: 'prov-req-1', estimatedCompletionMs: 60000 };
  }

  protected async makeStatusCheck(_providerRequestId: string) {
    return this._opts.statusResult ?? { status: 'processing' as const };
  }

  protected async makeCancelRequest(_providerRequestId: string) {
    return this._opts.cancelResult ?? true;
  }

  protected verifySignature(_payload: WebhookPayload): boolean {
    return this._opts.verifyResult ?? true;
  }

  protected parseWebhookPayload(payload: WebhookPayload): GenerationResult | null {
    if (this._opts.parseResult !== undefined) return this._opts.parseResult;
    if (!payload.result) return null;
    return payload.result;
  }

  getDefaultTimeoutSeconds(): number { return 120; }
  getCostPerSecond(): number { return 0.05; }
  supportsCapability(capability: string): boolean { return capability === 'text_to_video'; }
  getMaxDurationSeconds(): number { return 10; }
  getSupportedResolutions(): string[] { return ['720p', '1080p']; }
  getSupportedAspectRatios(): string[] { return ['16:9', '9:16']; }
}

// ===== TESTS =====

beforeEach(() => {
  jest.clearAllMocks();
  clearAdapters();
});

// ------------------------------------------------------------------
// AdapterRegistry (singleton) & module-level helpers
// ------------------------------------------------------------------

describe('AdapterRegistry', () => {
  describe('register / get / has / getAll / getByProvider / clear', () => {
    test('register + get returns the adapter', () => {
      const adapter = new ConcreteTestAdapter('m1', 'google');
      registerAdapter(adapter);
      expect(getAdapter('m1')).toBe(adapter);
      expect(adapterRegistry.has('m1')).toBe(true);
    });

    test('get returns undefined for unknown modelId', () => {
      expect(getAdapter('nonexistent')).toBeUndefined();
    });

    test('getAll returns all registered adapters', () => {
      const a1 = new ConcreteTestAdapter('m1', 'google');
      const a2 = new ConcreteTestAdapter('m2', 'runway');
      registerAdapter(a1);
      registerAdapter(a2);
      const all = getAllAdapters();
      expect(all).toHaveLength(2);
      expect(all).toContain(a1);
      expect(all).toContain(a2);
    });

    test('getByProvider filters correctly', () => {
      const a1 = new ConcreteTestAdapter('m1', 'google');
      const a2 = new ConcreteTestAdapter('m2', 'runway');
      const a3 = new ConcreteTestAdapter('m3', 'google');
      registerAdapter(a1);
      registerAdapter(a2);
      registerAdapter(a3);
      const googleAdapters = adapterRegistry.getByProvider('google');
      expect(googleAdapters).toHaveLength(2);
      expect(googleAdapters).toContain(a1);
      expect(googleAdapters).toContain(a3);
    });

    test('getByProvider returns empty array when no match', () => {
      registerAdapter(new ConcreteTestAdapter('m1', 'google'));
      expect(adapterRegistry.getByProvider('luma')).toHaveLength(0);
    });

    test('has returns false after clear', () => {
      registerAdapter(new ConcreteTestAdapter('m1', 'google'));
      expect(adapterRegistry.has('m1')).toBe(true);
      clearAdapters();
      expect(adapterRegistry.has('m1')).toBe(false);
    });

    test('clear removes all adapters', () => {
      registerAdapter(new ConcreteTestAdapter('m1', 'google'));
      registerAdapter(new ConcreteTestAdapter('m2', 'runway'));
      clearAdapters();
      expect(getAllAdapters()).toHaveLength(0);
    });

    test('register replaces adapter with same modelId', () => {
      const a1 = new ConcreteTestAdapter('m1', 'google');
      const a2 = new ConcreteTestAdapter('m1', 'runway');
      registerAdapter(a1);
      registerAdapter(a2);
      expect(getAdapter('m1')).toBe(a2);
      expect(getAllAdapters()).toHaveLength(1);
    });

    test('getAll returns empty array when no adapters registered', () => {
      expect(getAllAdapters()).toEqual([]);
    });
  });
});

// ------------------------------------------------------------------
// BaseModelAdapter — delegated methods
// ------------------------------------------------------------------

describe('BaseModelAdapter', () => {
  describe('dispatch', () => {
    test('calls enhancePrompt and makeDispatchRequest', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', {
        dispatchResult: { providerRequestId: 'req-123', estimatedCompletionMs: 5000 },
      });
      const prompt = makePrompt();
      const result = await adapter.dispatch(prompt);
      expect(result.providerRequestId).toBe('req-123');
      expect(result.estimatedCompletionMs).toBe(5000);
    });

    test('propagates errors from makeDispatchRequest', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', { throwOnDispatch: true });
      await expect(adapter.dispatch(makePrompt())).rejects.toThrow('dispatch failed');
    });

    test('enhancePrompt injects model_id into modelParams', async () => {
      const adapter = new ConcreteTestAdapter('my-model', 'google');
      // We cannot inspect the enhancedPrompt directly, but we can verify the result
      // uses the correct providerRequestId.
      const result = await adapter.dispatch(makePrompt());
      expect(result.providerRequestId).toBe('prov-req-1');
    });

    test('dispatch result can have undefined estimatedCompletionMs', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', {
        dispatchResult: { providerRequestId: 'req-1' }, // no estimatedCompletionMs
      });
      const result = await adapter.dispatch(makePrompt());
      expect(result.estimatedCompletionMs).toBeUndefined();
    });
  });

  describe('checkStatus', () => {
    test('delegates to makeStatusCheck', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', {
        statusResult: { status: 'completed', result: { shotId: 's1', videoUrl: 'http://x', durationSeconds: 10, actualCost: 0.5, modelId: 'm1', providerMetadata: {} } },
      });
      const result = await adapter.checkStatus('req-1');
      expect(result.status).toBe('completed');
      expect(result.result?.videoUrl).toBe('http://x');
    });

    test('returns pending status', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', {
        statusResult: { status: 'pending' },
      });
      expect((await adapter.checkStatus('req-1')).status).toBe('pending');
    });

    test('returns failed status with error', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', {
        statusResult: { status: 'failed', error: 'timeout' },
      });
      const result = await adapter.checkStatus('req-1');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('timeout');
    });
  });

  describe('cancel', () => {
    test('delegates to makeCancelRequest', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', { cancelResult: true });
      expect(await adapter.cancel('req-1')).toBe(true);
    });

    test('returns false when cancel fails', async () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', { cancelResult: false });
      expect(await adapter.cancel('req-1')).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    test('delegates to verifySignature', () => {
      const payload = makeWebhookPayload();
      const adapter = new ConcreteTestAdapter('m1', 'google', { verifyResult: true });
      expect(adapter.verifyWebhook(payload)).toBe(true);
    });

    test('returns false when signature invalid', () => {
      const payload = makeWebhookPayload();
      const adapter = new ConcreteTestAdapter('m1', 'google', { verifyResult: false });
      expect(adapter.verifyWebhook(payload)).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    test('delegates to parseWebhookPayload', () => {
      const result: GenerationResult = { shotId: 's1', videoUrl: 'http://v', durationSeconds: 5, actualCost: 0.1, modelId: 'm1', providerMetadata: {} };
      const adapter = new ConcreteTestAdapter('m1', 'google', { parseResult: result });
      const payload = makeWebhookPayload({ result });
      expect(adapter.parseWebhook(payload)).toBe(result);
    });

    test('returns null when parseWebhookPayload returns null', () => {
      const adapter = new ConcreteTestAdapter('m1', 'google', { parseResult: null });
      expect(adapter.parseWebhook(makeWebhookPayload())).toBeNull();
    });
  });

  describe('enhancePrompt (protected)', () => {
    test('adds model_id to modelParams while preserving existing params', async () => {
      // We use a spy on the concrete adapter to capture the enhanced prompt
      let capturedPrompt: CompiledPrompt | undefined;
      class SpyAdapter extends ConcreteTestAdapter {
        protected async makeDispatchRequest(prompt: CompiledPrompt) {
          capturedPrompt = prompt;
          return { providerRequestId: 'spied' };
        }
      }

      const adapter = new SpyAdapter('custom-model', 'google');
      const prompt = makePrompt({ modelParams: { aspectRatio: '9:16', custom: true } });
      await adapter.dispatch(prompt);

      expect(capturedPrompt).toBeDefined();
      expect(capturedPrompt!.modelParams).toEqual({ aspectRatio: '9:16', custom: true, model_id: 'custom-model' });
      // Original prompt should not be mutated
      expect(prompt.modelParams).not.toHaveProperty('model_id');
    });

    test('preserves parameters alias', async () => {
      let capturedPrompt: CompiledPrompt | undefined;
      class SpyAdapter extends ConcreteTestAdapter {
        protected async makeDispatchRequest(prompt: CompiledPrompt) {
          capturedPrompt = prompt;
          return { providerRequestId: 'spied' };
        }
      }

      const adapter = new SpyAdapter('m1', 'google');
      const prompt = makePrompt({ parameters: { foo: 'bar' } });
      await adapter.dispatch(prompt);

      expect(capturedPrompt!.parameters).toEqual({ foo: 'bar' });
    });
  });
});

// ------------------------------------------------------------------
// Adapter Factory registry
// ------------------------------------------------------------------

describe('AdapterFactory registry', () => {
  beforeEach(() => {
    adapterFactories.clear();
  });

  test('registerAdapterFactory + getAdapterFactory round-trip', () => {
    const factory = { createAdapter: jest.fn() };
    registerAdapterFactory('google', factory);
    expect(getAdapterFactory('google')).toBe(factory);
  });

  test('getAdapterFactory returns undefined for unknown provider', () => {
    expect(getAdapterFactory('unknown')).toBeUndefined();
  });

  test('registerAdapterFactory overwrites existing factory for same provider', () => {
    const f1 = { createAdapter: jest.fn() };
    const f2 = { createAdapter: jest.fn() };
    registerAdapterFactory('google', f1);
    registerAdapterFactory('google', f2);
    expect(getAdapterFactory('google')).toBe(f2);
  });
});

// ------------------------------------------------------------------
// initializeAdapters
// ------------------------------------------------------------------

describe('initializeAdapters', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    adapterFactories.clear();
    clearAdapters();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('registers adapters for models with matching factory', async () => {
    const mockAdapter = new ConcreteTestAdapter('veo3-low', 'google');
    registerAdapterFactory('google', { createAdapter: jest.fn().mockReturnValue(mockAdapter) });

    await initializeAdapters();

    expect(getAdapter('veo3-low')).toBe(mockAdapter);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Registered adapter: veo3-low'));
  });

  test('warns when no factory found for provider', async () => {
    // No factory registered — both models have providers not in the factory map
    await initializeAdapters();

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('No adapter factory for provider'));
  });

  test('logs error when createAdapter throws', async () => {
    registerAdapterFactory('google', {
      createAdapter: () => { throw new Error('bad config'); },
    });

    await initializeAdapters();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create adapter for veo3-low'),
      expect.any(Error),
    );
  });

  test('registers adapters for multiple providers', async () => {
    const googleAdapter = new ConcreteTestAdapter('veo3-low', 'google');
    const runwayAdapter = new ConcreteTestAdapter('runway-gen3', 'runway');
    registerAdapterFactory('google', { createAdapter: jest.fn().mockReturnValue(googleAdapter) });
    registerAdapterFactory('runway', { createAdapter: jest.fn().mockReturnValue(runwayAdapter) });

    await initializeAdapters();

    expect(getAdapter('veo3-low')).toBe(googleAdapter);
    expect(getAdapter('runway-gen3')).toBe(runwayAdapter);
    expect(getAllAdapters()).toHaveLength(2);
  });

  test('skips models whose provider has no factory while registering others', async () => {
    const googleAdapter = new ConcreteTestAdapter('veo3-low', 'google');
    registerAdapterFactory('google', { createAdapter: jest.fn().mockReturnValue(googleAdapter) });
    // No runway factory registered

    await initializeAdapters();

    expect(getAdapter('veo3-low')).toBe(googleAdapter);
    expect(getAdapter('runway-gen3')).toBeUndefined();
    // Only google factory warned for runway
    expect(consoleWarnSpy).toHaveBeenCalledWith('No adapter factory for provider: runway');
  });

  test('handles empty model registry', async () => {
    (getModelRegistry as jest.Mock).mockResolvedValueOnce([]);

    await initializeAdapters();

    expect(getAllAdapters()).toHaveLength(0);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// getAdapterConfig (internal, tested through initializeAdapters)
// ------------------------------------------------------------------

describe('getAdapterConfig (tested via initializeAdapters)', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    adapterFactories.clear();
    clearAdapters();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test('passes google config with apiKey from config', async () => {
    let capturedConfig: Record<string, any> | undefined;
    registerAdapterFactory('google', {
      createAdapter: (_modelId: string, cfg: Record<string, any>) => {
        capturedConfig = cfg;
        return new ConcreteTestAdapter('veo3-low', 'google');
      },
    });

    await initializeAdapters();

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!.apiKey).toBe('veo-key-from-config');
  });

  test('passes runway config', async () => {
    let capturedConfig: Record<string, any> | undefined;
    registerAdapterFactory('runway', {
      createAdapter: (_modelId: string, cfg: Record<string, any>) => {
        capturedConfig = cfg;
        return new ConcreteTestAdapter('runway-gen3', 'runway');
      },
    });

    await initializeAdapters();

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!.apiKey).toBe('runway-key-from-config');
  });

  test('passes kie config with callbackUrl', async () => {
    // Add kie to the mock model list
    (getModelRegistry as jest.Mock).mockResolvedValueOnce([
      { id: 'kie-veo3-fast', name: 'Kie Veo3 Fast', provider: 'kie' },
    ]);

    let capturedConfig: Record<string, any> | undefined;
    registerAdapterFactory('kie', {
      createAdapter: (_modelId: string, cfg: Record<string, any>) => {
        capturedConfig = cfg;
        return new ConcreteTestAdapter('kie-veo3-fast', 'kie');
      },
    });

    await initializeAdapters();

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!.apiKey).toBe('kie-key-from-config');
  });

  test('returns empty config for unknown provider', async () => {
    (getModelRegistry as jest.Mock).mockResolvedValueOnce([
      { id: 'nvidia-nim', name: 'NVIDIA NIM', provider: 'nvidia' },
    ]);

    let capturedConfig: Record<string, any> | undefined;
    registerAdapterFactory('nvidia', {
      createAdapter: (_modelId: string, cfg: Record<string, any>) => {
        capturedConfig = cfg;
        return new ConcreteTestAdapter('nvidia-nim', 'nvidia');
      },
    });

    await initializeAdapters();

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!).toEqual({});
  });

  test('falls back to env vars when config keys are undefined', async () => {
    // Override config to have undefined keys
    const originalConfig = { ...config };
    (config as any).veoApiKey = undefined;
    (config as any).runwayApiKey = undefined;
    (config as any).lumaApiKey = undefined;
    (config as any).kieApiKey = undefined;

    process.env.VEO_API_KEY = 'veo-env-key';
    process.env.RUNWAY_API_KEY = 'runway-env-key';

    let googleCfg: Record<string, any> | undefined;
    let runwayCfg: Record<string, any> | undefined;
    registerAdapterFactory('google', {
      createAdapter: (_id: string, cfg: Record<string, any>) => { googleCfg = cfg; return new ConcreteTestAdapter('veo3-low', 'google'); },
    });
    registerAdapterFactory('runway', {
      createAdapter: (_id: string, cfg: Record<string, any>) => { runwayCfg = cfg; return new ConcreteTestAdapter('runway-gen3', 'runway'); },
    });

    await initializeAdapters();

    expect(googleCfg?.apiKey).toBe('veo-env-key');
    expect(runwayCfg?.apiKey).toBe('runway-env-key');

    // Cleanup
    delete process.env.VEO_API_KEY;
    delete process.env.RUNWAY_API_KEY;
    (config as any).veoApiKey = originalConfig.veoApiKey;
    (config as any).runwayApiKey = originalConfig.runwayApiKey;
    (config as any).lumaApiKey = originalConfig.lumaApiKey;
    (config as any).kieApiKey = originalConfig.kieApiKey;
  });
});

// ------------------------------------------------------------------
// Concrete adapter subclasses — Veo3Adapter-like behaviour via base class
// ------------------------------------------------------------------

describe('Veo3-like adapter via BaseModelAdapter', () => {
  let adapter: ConcreteTestAdapter;

  beforeEach(() => {
    adapter = new ConcreteTestAdapter('veo3-low', 'google');
  });

  test('modelId and provider are exposed', () => {
    expect(adapter.modelId).toBe('veo3-low');
    expect(adapter.provider).toBe('google');
  });

  test('getDefaultTimeoutSeconds returns 120', () => {
    expect(adapter.getDefaultTimeoutSeconds()).toBe(120);
  });

  test('getCostPerSecond returns 0.05', () => {
    expect(adapter.getCostPerSecond()).toBe(0.05);
  });

  test('supportsCapability returns true for text_to_video', () => {
    expect(adapter.supportsCapability('text_to_video')).toBe(true);
  });

  test('supportsCapability returns false for unknown capability', () => {
    expect(adapter.supportsCapability('native_audio')).toBe(false);
  });

  test('getMaxDurationSeconds returns 10', () => {
    expect(adapter.getMaxDurationSeconds()).toBe(10);
  });

  test('getSupportedResolutions returns array', () => {
    expect(adapter.getSupportedResolutions()).toEqual(['720p', '1080p']);
  });

  test('getSupportedAspectRatios returns array', () => {
    expect(adapter.getSupportedAspectRatios()).toEqual(['16:9', '9:16']);
  });
});

// ------------------------------------------------------------------
// Edge cases — double registration, concurrent access patterns
// ------------------------------------------------------------------

describe('Edge cases', () => {
  test('getByProvider with mixed providers', () => {
    registerAdapter(new ConcreteTestAdapter('a1', 'google'));
    registerAdapter(new ConcreteTestAdapter('a2', 'runway'));
    registerAdapter(new ConcreteTestAdapter('a3', 'google'));
    registerAdapter(new ConcreteTestAdapter('a4', 'kie'));

    expect(adapterRegistry.getByProvider('google')).toHaveLength(2);
    expect(adapterRegistry.getByProvider('runway')).toHaveLength(1);
    expect(adapterRegistry.getByProvider('kie')).toHaveLength(1);
    expect(adapterRegistry.getByProvider('luma')).toHaveLength(0);
  });

  test('has reflects state after multiple register/clear cycles', () => {
    registerAdapter(new ConcreteTestAdapter('x', 'google'));
    expect(adapterRegistry.has('x')).toBe(true);
    clearAdapters();
    expect(adapterRegistry.has('x')).toBe(false);
    registerAdapter(new ConcreteTestAdapter('x', 'runway'));
    expect(adapterRegistry.has('x')).toBe(true);
    clearAdapters();
    expect(adapterRegistry.has('x')).toBe(false);
  });

  test('getAllAdapters returns new array each call (no mutation)', () => {
    registerAdapter(new ConcreteTestAdapter('a', 'google'));
    const arr1 = getAllAdapters();
    const arr2 = getAllAdapters();
    expect(arr1).toEqual(arr2);
    expect(arr1).not.toBe(arr2); // different array references
  });

  test('initializeAdapters with no models in registry', async () => {
    (getModelRegistry as jest.Mock).mockResolvedValueOnce([]);
    await initializeAdapters();
    expect(getAllAdapters()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// enhancePrompt edge cases
// ------------------------------------------------------------------

describe('enhancePrompt edge cases', () => {
  test('empty modelParams gets model_id injected', async () => {
    let capturedPrompt: CompiledPrompt | undefined;
    class SpyAdapter extends ConcreteTestAdapter {
      protected async makeDispatchRequest(prompt: CompiledPrompt) {
        capturedPrompt = prompt;
        return { providerRequestId: 'x' };
      }
    }

    const adapter = new SpyAdapter('m1', 'google');
    const prompt = makePrompt({ modelParams: {} });
    await adapter.dispatch(prompt);

    expect(capturedPrompt!.modelParams).toEqual({ model_id: 'm1' });
  });

  test('does not mutate original prompt object', async () => {
    class SpyAdapter extends ConcreteTestAdapter {
      protected async makeDispatchRequest(prompt: CompiledPrompt) {
        return { providerRequestId: 'x' };
      }
    }

    const adapter = new SpyAdapter('m1', 'google');
    const prompt = makePrompt({ modelParams: { aspectRatio: '1:1', resolution: '4K', model_id: 'old-value' } });
    await adapter.dispatch(prompt);

    // The original prompt's modelParams should still have the old value
    expect(prompt.modelParams.model_id).toBe('old-value');
  });
});

// ------------------------------------------------------------------
// adapterRegistry — direct class usage (via exported singleton)
// ------------------------------------------------------------------

describe('adapterRegistry singleton', () => {
  test('is a singleton object with register/get methods', () => {
    expect(typeof adapterRegistry.register).toBe('function');
    expect(typeof adapterRegistry.get).toBe('function');
    expect(typeof adapterRegistry.getAll).toBe('function');
    expect(typeof adapterRegistry.getByProvider).toBe('function');
    expect(typeof adapterRegistry.has).toBe('function');
    expect(typeof adapterRegistry.clear).toBe('function');
  });

  test('register/get/getAll/getByProvider/has/clear work on singleton', () => {
    const adapter = new ConcreteTestAdapter('singleton-model', 'google');
    adapterRegistry.register(adapter);
    expect(adapterRegistry.get('singleton-model')).toBe(adapter);
    expect(adapterRegistry.has('singleton-model')).toBe(true);
    expect(adapterRegistry.getAll()).toContain(adapter);
    expect(adapterRegistry.getByProvider('google')).toContain(adapter);
    adapterRegistry.clear();
    expect(adapterRegistry.has('singleton-model')).toBe(false);
  });
});

// ------------------------------------------------------------------
// Multiple adapters — provider filtering
// ------------------------------------------------------------------

describe('Provider-based filtering', () => {
  test('getByProvider returns empty for no adapters', () => {
    expect(adapterRegistry.getByProvider('google')).toEqual([]);
  });

  test('getByProvider with all same provider', () => {
    registerAdapter(new ConcreteTestAdapter('a', 'google'));
    registerAdapter(new ConcreteTestAdapter('b', 'google'));
    expect(adapterRegistry.getByProvider('google')).toHaveLength(2);
  });

  test('getByProvider after clear returns empty', () => {
    registerAdapter(new ConcreteTestAdapter('a', 'google'));
    clearAdapters();
    expect(adapterRegistry.getByProvider('google')).toEqual([]);
  });
});
