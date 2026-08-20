/**
 * Unit tests for Prompt Compiler — full branch coverage
 */

import { jest } from '@jest/globals';
import {
  compilePrompt,
  compilePromptsForStory,
  validatePromptForModel,
  enhancePromptWithLLM,
  chunkScript,
  buildMultiFaceLockConditioning,
  truncatePrompt,
  getDurationParamKey,
} from '../../../src/generation/promptCompiler';
import type {
  ShotPlan,
  CharacterRegistryEntry,
  ModelCapabilities,
  CompiledPrompt,
} from '../../../src/shared/types';

// ==========================================
// Mocks
// ==========================================

const mockGenerateContent = jest.fn<() => Promise<{ response: { text: () => string } }>>();

jest.mock('../../../src/shared/config', () => ({
  config: {
    faceLock: {
      perModelCharacterThresholds: {},
      defaultPerModelThresholds: {
        'veo3-low': 0.75,
        'veo3-high': 0.80,
        'runway-gen3': 0.85,
        'pika-1.5': 0.78,
        'kling-v1': 0.80,
        'kling-v1.5': 0.80,
        'runway-gen3-turbo': 0.85,
      },
      maxRetries: 3,
      perModelCharacterRetries: {},
    },
    llmApiKey: undefined,
  },
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: mockGenerateContent,
    }),
  })),
}));

jest.mock('../../../src/sanitizer/promptSanitizer', () => {
  const actual = jest.requireActual('../../../src/sanitizer/promptSanitizer');
  return {
    ...(actual as any),
    sanitizePrompt: jest.fn((text: string, _constraints: any) => ({
      sanitized: text,
      piiFound: false,
      injectionsFound: false,
      warnings: [],
    })),
  };
});

// ==========================================
// Test helpers
// ==========================================

const createCharacter = (overrides: Partial<CharacterRegistryEntry> = {}): CharacterRegistryEntry => ({
  id: 'char-1',
  userId: 'user-1',
  storyId: 'story-1',
  name: 'John',
  faceEmbedding: new Array(512).fill(0.1),
  voiceEmbedding: undefined,
  referenceImageHash: 'hash-123',
  metadata: { identityStrength: 0.8 },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createShot = (overrides: Partial<ShotPlan> = {}): ShotPlan => ({
  id: 'shot-1',
  storyId: 'story-1',
  order: 1,
  visualDescription: 'John walks through a forest at sunset',
  durationSeconds: 8,
  cameraMotion: 'static',
  characters: ['John'],
  keyObjects: ['forest', 'sunset'],
  keyActions: ['walking'],
  negativePrompts: [],
  status: 'approved',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createModel = (overrides: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  id: 'veo3-low',
  name: 'Veo 3 Low Quality',
  provider: 'google',
  maxResolution: '720p',
  maxDurationSeconds: 10,
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  supportedRegions: ['us', 'eu'],
  costPerSecondUsd: 0.0,
  costCurrency: 'USD',
  capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
  defaultTimeoutSeconds: 120,
  ...overrides,
});

// ==========================================
// Tests
// ==========================================

describe('Prompt Compiler', () => {
  const mockCharacter = createCharacter();
  const mockShot = createShot();
  const mockModel = createModel();

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset config.llmApiKey to undefined
    const { config } = require('../../../src/shared/config');
    config.llmApiKey = undefined;
  });

  // ==========================================
  // enhancePromptWithLLM
  // ==========================================
  describe('enhancePromptWithLLM', () => {
    test('enhances prompt successfully', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Enhanced prompt text' },
      });

      const result = await enhancePromptWithLLM('Original prompt', mockShot, 'test-api-key');
      expect(result).toBe('Enhanced prompt text');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    test('builds context parts with all shot fields', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Enhanced' },
      });

      const shot = createShot({
        cameraMotion: 'pan_left',
        characters: ['John'],
        keyObjects: ['tree'],
        keyActions: ['walking'],
        audioCues: ['birds chirping'],
      });

      await enhancePromptWithLLM('prompt', shot, 'key');
      // Verify generateContent was called (context was built without error)
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    test('builds context without optional fields (empty arrays, no cameraMotion)', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Enhanced' },
      });

      const shot = createShot({
        cameraMotion: undefined as any,
        characters: [],
        keyObjects: [],
        keyActions: [],
        audioCues: undefined,
      });

      await enhancePromptWithLLM('prompt', shot, 'key');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    test('falls back to template when response is empty', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => '' },
      });

      const result = await enhancePromptWithLLM('Fallback prompt', mockShot, 'key');
      expect(result).toBe('Fallback prompt');
    });

    test('falls back to template when response exceeds 6000 chars', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'x'.repeat(6001) },
      });

      const result = await enhancePromptWithLLM('Fallback', mockShot, 'key');
      expect(result).toBe('Fallback');
    });

    test('falls back to template on Error instance', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const result = await enhancePromptWithLLM('Fallback', mockShot, 'key');
      expect(result).toBe('Fallback');
    });

    test('falls back to template on non-Error thrown', async () => {
      mockGenerateContent.mockRejectedValue('string error');

      const result = await enhancePromptWithLLM('Fallback', mockShot, 'key');
      expect(result).toBe('Fallback');
    });

    test('trims whitespace from valid response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => '  Enhanced prompt  ' },
      });

      const result = await enhancePromptWithLLM('Original', mockShot, 'key');
      expect(result).toBe('Enhanced prompt');
    });
  });

  // ==========================================
  // chunkScript
  // ==========================================
  describe('chunkScript', () => {
    test('uses default maxChars of 5000 when not provided', () => {
      const result = chunkScript('Short script');
      expect(result).toEqual(['Short script']);
    });

    test('returns single chunk when script fits in maxChars', () => {
      const result = chunkScript('Short script', 5000);
      expect(result).toEqual(['Short script']);
    });

    test('splits on paragraph boundaries', () => {
      const script = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
      const result = chunkScript(script, 25);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('splits on sentence boundaries when no good paragraph boundary', () => {
      const script = 'Sentence one. Sentence two. Sentence three. Sentence four.';
      const result = chunkScript(script, 30);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('splits on word boundaries when no sentence boundary available', () => {
      const script = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10';
      const result = chunkScript(script, 20);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('hard splits when no good boundary found', () => {
      const script = 'aaaaabbbbbcccccdddddeeeee';
      const result = chunkScript(script, 10);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test('filters out empty chunks', () => {
      const result = chunkScript('A', 100);
      expect(result.every(c => c.length > 0)).toBe(true);
    });

    test('handles script that needs multiple splits', () => {
      const script = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.';
      const result = chunkScript(script, 30);
      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    test('handles script with only whitespace boundaries', () => {
      const script = 'aaaa bbbbb ccccc ddddd eeeee fffff ggggg';
      const result = chunkScript(script, 15);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================
  // buildMultiFaceLockConditioning
  // ==========================================
  describe('buildMultiFaceLockConditioning', () => {
    test('returns empty array when no characters in shot', async () => {
      const shot = createShot({ characters: [] });
      const result = await buildMultiFaceLockConditioning(shot, [mockCharacter], mockModel);
      expect(result).toEqual([]);
    });

    test('returns conditioning for single character', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result).toHaveLength(1);
      expect(result[0].characterName).toBe('John');
    });

    test('returns conditioning for multiple characters', async () => {
      const char2 = createCharacter({ id: 'char-2', name: 'Jane', referenceImageHash: 'hash-456' });
      const shot = createShot({ characters: ['John', 'Jane'] });
      const result = await buildMultiFaceLockConditioning(shot, [mockCharacter, char2], mockModel);
      expect(result).toHaveLength(2);
    });

    test('uses referenceImageBase64 over referenceImageHash when available', async () => {
      const char = createCharacter({ referenceImageBase64: 'base64-data', referenceImageHash: 'hash-data' });
      const result = await buildMultiFaceLockConditioning(mockShot, [char], mockModel);
      expect(result[0].referenceImageBase64).toBe('base64-data');
    });

    test('falls back to referenceImageHash when referenceImageBase64 is empty', async () => {
      const char = createCharacter({ referenceImageBase64: '', referenceImageHash: 'hash-fallback' });
      const result = await buildMultiFaceLockConditioning(mockShot, [char], mockModel);
      expect(result[0].referenceImageBase64).toBe('hash-fallback');
    });

    test('falls back to empty string when both referenceImageBase64 and referenceImageHash are empty', async () => {
      const char = createCharacter({ referenceImageBase64: '', referenceImageHash: '' });
      const result = await buildMultiFaceLockConditioning(mockShot, [char], mockModel);
      expect(result[0].referenceImageBase64).toBe('');
    });

    test('uses identityStrength from metadata when present', async () => {
      const char = createCharacter({ metadata: { identityStrength: 0.95 } });
      const result = await buildMultiFaceLockConditioning(mockShot, [char], mockModel);
      expect(result[0].identityStrength).toBe(0.95);
    });

    test('defaults identityStrength to 0.8 when not in metadata', async () => {
      const char = createCharacter({ metadata: {} });
      const result = await buildMultiFaceLockConditioning(mockShot, [char], mockModel);
      expect(result[0].identityStrength).toBe(0.8);
    });

    test('passes retryCount to model params', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel, 2);
      expect(result[0].modelSpecificParams.retry_count).toBe(2);
    });

    test('defaults retryCount to 0', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].modelSpecificParams.retry_count).toBe(0);
    });

    test('defaults retryCount to 0 when passed undefined', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel, undefined);
      expect(result[0].modelSpecificParams.retry_count).toBe(0);
    });

    test('includes consistencyThreshold from config', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].consistencyThreshold).toBe(0.75);
    });

    test('falls back to 0.75 for unknown model threshold', async () => {
      const unknownModel = createModel({ id: 'unknown-model' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], unknownModel);
      expect(result[0].consistencyThreshold).toBe(0.75);
    });

    test('includes maxRetries from config', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].maxRetries).toBe(3);
    });

    test('defaults maxRetries to 3 when config value is falsy', async () => {
      const { config } = require('../../../src/shared/config');
      const orig = config.faceLock.maxRetries;
      config.faceLock.maxRetries = 0;
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].maxRetries).toBe(3);
      config.faceLock.maxRetries = orig;
    });

    test('includes reference_image in base params', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].modelSpecificParams.reference_image).toBe('hash-123');
    });

    test('includes identity_scale in base params', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      expect(result[0].modelSpecificParams.identity_scale).toBe(0.8);
    });
  });

  // ==========================================
  // getModelFaceLockParams (via buildMultiFaceLockConditioning)
  // ==========================================
  describe('Model-specific Face-Lock params', () => {
    test('veo3-low returns subject_reference params', async () => {
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], mockModel);
      const params = result[0].modelSpecificParams;
      expect(params.subject_reference).toBe('hash-123');
      expect(params.subject_strength).toBe(0.8);
      expect(params.consistency_guidance).toBe(true);
    });

    test('veo3-high returns subject_reference params', async () => {
      const model = createModel({ id: 'veo3-high' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.subject_reference).toBeDefined();
      expect(params.consistency_guidance).toBe(true);
    });

    test('runway-gen3 returns reference_images array params', async () => {
      const model = createModel({ id: 'runway-gen3' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.reference_images).toEqual(['hash-123']);
      expect(params.reference_strength).toBe(0.8);
      expect(params.motion_bucket).toBe(50);
    });

    test('runway-gen3-turbo returns reference_images array params', async () => {
      const model = createModel({ id: 'runway-gen3-turbo' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.reference_images).toEqual(['hash-123']);
      expect(params.motion_bucket).toBe(50);
    });

    test('pika-1.5 returns character_reference params', async () => {
      const model = createModel({ id: 'pika-1.5' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.character_reference).toBe('hash-123');
      expect(params.character_weight).toBe(0.8);
    });

    test('kling-v1 returns image_reference params', async () => {
      const model = createModel({ id: 'kling-v1' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.image_reference).toBe('hash-123');
      expect(params.subject_consistency).toBe(0.8);
    });

    test('kling-v1.5 returns image_reference params', async () => {
      const model = createModel({ id: 'kling-v1.5' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.image_reference).toBeDefined();
    });

    test('unknown model returns base params only', async () => {
      const model = createModel({ id: 'unknown-model' });
      const result = await buildMultiFaceLockConditioning(mockShot, [mockCharacter], model);
      const params = result[0].modelSpecificParams;
      expect(params.reference_image).toBe('hash-123');
      expect(params.identity_scale).toBe(0.8);
      expect(params.retry_count).toBe(0);
      // Should NOT have model-specific keys
      expect(params.subject_reference).toBeUndefined();
      expect(params.reference_images).toBeUndefined();
      expect(params.character_reference).toBeUndefined();
      expect(params.image_reference).toBeUndefined();
    });
  });

  // ==========================================
  // buildBasePrompt (via compilePrompt)
  // ==========================================
  describe('buildBasePrompt', () => {
    test('includes visualDescription', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.prompt).toContain('John walks through a forest at sunset');
    });

    test('includes cameraMotion', async () => {
      const shot = createShot({ cameraMotion: 'pan_left' });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).toContain('Camera: pan_left');
    });

    test('includes durationSeconds', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.prompt).toContain('Duration: 8 seconds');
    });

    test('includes stylePreset when provided', async () => {
      const result = await compilePrompt(mockShot, [], mockModel, { stylePreset: 'cinematic' });
      expect(result.prompt).toContain('Style: cinematic');
    });

    test('excludes stylePreset when not provided', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.prompt).not.toContain('Style:');
    });

    test('includes keyObjects', async () => {
      const shot = createShot({ keyObjects: ['lamp', 'table'] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).toContain('Objects: lamp, table');
    });

    test('excludes Objects when keyObjects is empty', async () => {
      const shot = createShot({ keyObjects: [] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).not.toContain('Objects:');
    });

    test('includes keyActions', async () => {
      const shot = createShot({ keyActions: ['dancing', 'singing'] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).toContain('Actions: dancing, singing');
    });

    test('excludes Actions when keyActions is empty', async () => {
      const shot = createShot({ keyActions: [] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).not.toContain('Actions:');
    });

    test('includes audioCues', async () => {
      const shot = createShot({ audioCues: ['thunder', 'rain'] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).toContain('Audio: thunder, rain');
    });

    test('excludes Audio when audioCues is undefined', async () => {
      const shot = createShot({ audioCues: undefined });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).not.toContain('Audio:');
    });

    test('excludes Audio when audioCues is empty', async () => {
      const shot = createShot({ audioCues: [] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).not.toContain('Audio:');
    });

    test('handles shot with no visualDescription', async () => {
      const shot = createShot({ visualDescription: '' });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.prompt).toContain('Camera: static');
    });
  });

  // ==========================================
  // compilePrompt — LLM branch
  // ==========================================
  describe('compilePrompt — LLM branches', () => {
    test('calls enhancePromptWithLLM when config.llmApiKey is set', async () => {
      const { config } = require('../../../src/shared/config');
      config.llmApiKey = 'test-key';

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'LLM enhanced prompt' },
      });

      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.prompt).toContain('LLM enhanced prompt');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    test('skips LLM when config.llmApiKey is undefined', async () => {
      const { config } = require('../../../src/shared/config');
      config.llmApiKey = undefined;

      await compilePrompt(mockShot, [], mockModel);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    test('skips LLM when skipLLM option is true', async () => {
      const { config } = require('../../../src/shared/config');
      config.llmApiKey = 'test-key';

      await compilePrompt(mockShot, [], mockModel, { skipLLM: true });
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    test('falls back to template when LLM returns empty', async () => {
      const { config } = require('../../../src/shared/config');
      config.llmApiKey = 'test-key';

      mockGenerateContent.mockResolvedValue({
        response: { text: () => '' },
      });

      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.prompt).toContain('John walks through a forest at sunset');
    });
  });

  // ==========================================
  // compilePrompt — truncation branch
  // ==========================================
  describe('compilePrompt — truncation', () => {
    test('truncates prompt when exceeding maxPromptLength', async () => {
      const shot = createShot({ visualDescription: 'A'.repeat(5000) });
      const result = await compilePrompt(shot, [], mockModel, { maxPromptLength: 100 });
      expect(result.prompt.length).toBeLessThanOrEqual(100);
    });

    test('does not truncate when prompt is within maxPromptLength', async () => {
      const result = await compilePrompt(mockShot, [], mockModel, { maxPromptLength: 10000 });
      expect(result.prompt).toContain('John walks through a forest at sunset');
    });
  });

  // ==========================================
  // compilePrompt — negative prompt branch
  // ==========================================
  describe('compilePrompt — negative prompt', () => {
    test('builds negative prompt when includeNegativePrompt is true (default)', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.negativePrompt).toBeDefined();
      expect(result.negativePrompt).toContain('blurry');
    });

    test('omits negative prompt when includeNegativePrompt is false', async () => {
      const result = await compilePrompt(mockShot, [], mockModel, { includeNegativePrompt: false });
      expect(result.negativePrompt).toBeUndefined();
    });
  });

  // ==========================================
  // compilePrompt — style references
  // ==========================================
  describe('compilePrompt — style references', () => {
    test('includes styleReferences from shot when present', async () => {
      const shot = createShot({ styleReferences: ['ref1', 'ref2'] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.styleReferences).toEqual(['ref1', 'ref2']);
    });

    test('defaults to empty array when styleReferences not set', async () => {
      const shot = createShot({ styleReferences: undefined });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.styleReferences).toEqual([]);
    });
  });

  // ==========================================
  // compilePrompt — reference images
  // ==========================================
  describe('compilePrompt — reference images', () => {
    test('collects reference images from characters in shot', async () => {
      const char = createCharacter({ referenceImageBase64: 'img-base64' });
      const result = await compilePrompt(mockShot, [char], mockModel);
      expect(result.characterConditioning[0].referenceImageBase64).toBe('img-base64');
    });

    test('collects no images when shot has no characters', async () => {
      const shot = createShot({ characters: [] });
      const result = await compilePrompt(shot, [mockCharacter], mockModel);
      expect(result.characterConditioning).toHaveLength(0);
    });

    test('falls back to referenceImageHash when referenceImageBase64 is empty', async () => {
      const char = createCharacter({ referenceImageBase64: '', referenceImageHash: 'hash-fallback' });
      const result = await compilePrompt(mockShot, [char], mockModel);
      expect(result.characterConditioning[0].referenceImageBase64).toBe('hash-fallback');
    });
  });

  // ==========================================
  // buildNegativePrompt
  // ==========================================
  describe('buildNegativePrompt', () => {
    test('includes veo3-specific negatives for veo3 models', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.negativePrompt).toContain('static camera');
      expect(result.negativePrompt).toContain('no motion');
    });

    test('includes runway-specific negatives for runway models', async () => {
      const model = createModel({ id: 'runway-gen3' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.negativePrompt).toContain('flickering');
      expect(result.negativePrompt).toContain('temporal inconsistency');
    });

    test('does not include veo3-specific negatives for other models', async () => {
      const model = createModel({ id: 'pika-1.5' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.negativePrompt).not.toContain('static camera');
    });

    test('does not include runway-specific negatives for other models', async () => {
      const model = createModel({ id: 'pika-1.5' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.negativePrompt).not.toContain('flickering');
    });

    test('includes shot-specific negativePrompts', async () => {
      const shot = createShot({ negativePrompts: ['no blurry faces', 'no extra hands'] });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.negativePrompt).toContain('no blurry faces');
      expect(result.negativePrompt).toContain('no extra hands');
    });

    test('does not include shot negatives when array is empty', async () => {
      const shot = createShot({ negativePrompts: [] });
      const result = await compilePrompt(shot, [], mockModel);
      // Still has base negatives
      expect(result.negativePrompt).toContain('blurry');
    });

    test('does not include shot negatives when undefined', async () => {
      const shot = createShot({ negativePrompts: undefined });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.negativePrompt).toContain('blurry');
    });
  });

  // ==========================================
  // mapParametersToModel
  // ==========================================
  describe('mapParametersToModel', () => {
    test('maps duration, resolution, aspect_ratio, fps, camera_motion', async () => {
      const shot = createShot({ durationSeconds: 10, cameraMotion: 'dolly_in', transition: undefined });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.parameters.duration_seconds).toBe(10);
      expect(result.parameters.output_resolution).toBe('720p');
      expect(result.parameters.aspect_ratio).toBe('16:9');
      expect(result.parameters.fps).toBe(24);
      expect(result.parameters.camera_control).toBe('dolly_in');
    });

    test('includes transition when present', async () => {
      const shot = createShot({ transition: { type: 'crossfade', durationSeconds: 0.5 } });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.parameters.transition).toBeDefined();
    });

    test('excludes transition when not present', async () => {
      const shot = createShot({ transition: undefined });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.parameters.transition).toBeUndefined();
    });

    test('maps for veo3-high', async () => {
      const model = createModel({ id: 'veo3-high' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.parameters.duration_seconds).toBeDefined();
      expect(result.parameters.output_resolution).toBeDefined();
    });

    test('maps for runway-gen3', async () => {
      const model = createModel({ id: 'runway-gen3' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.parameters.duration).toBeDefined();
      expect(result.parameters.resolution).toBeDefined();
    });

    test('maps for runway-gen3-turbo', async () => {
      const model = createModel({ id: 'runway-gen3-turbo' });
      const result = await compilePrompt(mockShot, [], model);
      expect(result.parameters.duration).toBeDefined();
    });

    test('no mapping for unknown model — keeps original keys', async () => {
      const model = createModel({ id: 'unknown-model' });
      const result = await compilePrompt(mockShot, [], model);
      // Unknown model has no mapping, so keys are preserved as-is (not renamed)
      expect(result.parameters.duration).toBe(8);
      expect(result.parameters.duration_seconds).toBeUndefined();
    });

    test('shot without duration still produces parameters', async () => {
      const shot = createShot({ durationSeconds: 0 });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.parameters.fps).toBe(24);
      expect(result.parameters.aspect_ratio).toBe('16:9');
    });

    test('shot without cameraMotion excludes camera_control', async () => {
      const shot = createShot({ cameraMotion: '' });
      const result = await compilePrompt(shot, [], mockModel);
      expect(result.parameters.camera_control).toBeUndefined();
    });
  });

  // ==========================================
  // validatePromptForModel
  // ==========================================
  describe('validatePromptForModel', () => {
    test('validates prompt length exceeds 4000', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'A'.repeat(5000),
        parameters: { duration_seconds: 5 },
        modelParams: { duration_seconds: 5 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('exceeds 4000'))).toBe(true);
    });

    test('passes when prompt length is within 4000', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Short prompt',
        parameters: {},
        modelParams: {},
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.valid).toBe(true);
    });

    test('validates Face-Lock support — model without image_to_video', () => {
      const model = createModel({ capabilities: ['text_to_video'] });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: {},
        modelParams: {},
        characterConditioning: [{
          characterName: 'John',
          referenceImageBase64: 'data',
          modelSpecificParams: {},
        }],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes("doesn't support image-to-video"))).toBe(true);
    });

    test('passes Face-Lock check when conditioning has no referenceImageBase64', () => {
      const model = createModel({ capabilities: ['text_to_video'] });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: {},
        modelParams: {},
        characterConditioning: [{
          characterName: 'John',
          referenceImageBase64: '',
          modelSpecificParams: {},
        }],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.issues.some(i => i.includes("doesn't support image-to-video"))).toBe(false);
    });

    test('passes Face-Lock check when characterConditioning is empty', () => {
      const model = createModel({ capabilities: ['text_to_video'] });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: {},
        modelParams: {},
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.issues.some(i => i.includes("doesn't support image-to-video"))).toBe(false);
    });

    test('passes Face-Lock check when characterConditioning is undefined', () => {
      const model = createModel({ capabilities: ['text_to_video'] });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: {},
        modelParams: {},
        characterConditioning: undefined as any,
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.issues.some(i => i.includes("doesn't support image-to-video"))).toBe(false);
    });

    test('validates duration exceeds model max (veo3)', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 15 },
        modelParams: { duration_seconds: 15 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(true);
    });

    test('validates duration exceeds model max (runway)', () => {
      const model = createModel({ id: 'runway-gen3' });
      const compiled: CompiledPrompt = {
        modelId: 'runway-gen3',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration: 15 },
        modelParams: { duration: 15 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(true);
    });

    test('passes when duration is within model max', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 5 },
        modelParams: { duration_seconds: 5 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(false);
    });

    test('skips duration check when duration param is not a number', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 'five' },
        modelParams: { duration_seconds: 'five' },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(false);
    });

    test('skips duration check when model has no maxDurationSeconds', () => {
      const model = createModel({ maxDurationSeconds: 0 });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 999 },
        modelParams: { duration_seconds: 999 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(false);
    });

    test('getDurationParamKey returns known key for recognized model', () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 5 },
        modelParams: { duration_seconds: 5 },
        characterConditioning: [],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, mockModel);
      expect(result.issues.some(i => i.includes('exceeds model max'))).toBe(false);
    });

    test('returns multiple issues when multiple validations fail', () => {
      const model = createModel({ capabilities: ['text_to_video'], maxDurationSeconds: 5 });
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'A'.repeat(5000),
        parameters: { duration_seconds: 10 },
        modelParams: { duration_seconds: 10 },
        characterConditioning: [{
          characterName: 'John',
          referenceImageBase64: 'data',
          modelSpecificParams: {},
        }],
        styleReferences: [],
      };
      const result = validatePromptForModel(compiled, model);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================
  // compilePromptsForStory
  // ==========================================
  describe('compilePromptsForStory', () => {
    test('compiles prompts for multiple shots', async () => {
      const shots = [
        mockShot,
        createShot({ id: 'shot-2', order: 2, visualDescription: 'Jane sits by a river' }),
      ];
      const result = await compilePromptsForStory(shots, [mockCharacter], [mockModel]);
      expect(result.size).toBe(2);
      expect(result.get('shot-1')).toHaveLength(1);
      expect(result.get('shot-2')).toHaveLength(1);
    });

    test('filters models by duration requirement', async () => {
      const longShot = createShot({ id: 'shot-long', durationSeconds: 20 });
      const result = await compilePromptsForStory([longShot], [mockCharacter], [mockModel]);
      expect(result.get('shot-long')).toHaveLength(0);
    });

    test('includes models that support shot requirements', async () => {
      const model = createModel({ maxDurationSeconds: 100 });
      const result = await compilePromptsForStory([mockShot], [mockCharacter], [model]);
      expect(result.get('shot-1')).toHaveLength(1);
    });

    test('returns empty array for shot when no models match', async () => {
      const longShot = createShot({ id: 'shot-long', durationSeconds: 100 });
      const result = await compilePromptsForStory([longShot], [mockCharacter], [mockModel]);
      expect(result.get('shot-long')).toHaveLength(0);
    });

    test('returns all shots in map', async () => {
      const shots = [mockShot];
      const result = await compilePromptsForStory(shots, [], [mockModel]);
      expect(result.has('shot-1')).toBe(true);
    });
  });

  // ==========================================
  // supportsShotRequirements
  // ==========================================
  describe('supportsShotRequirements', () => {
    test('returns true when shot duration is within model max', async () => {
      const model = createModel({ maxDurationSeconds: 10 });
      const shot = createShot({ durationSeconds: 8 });
      const result = await compilePromptsForStory([shot], [], [model]);
      expect(result.get('shot-1')).toHaveLength(1);
    });

    test('returns false when shot duration exceeds model max', async () => {
      const model = createModel({ maxDurationSeconds: 5 });
      const shot = createShot({ durationSeconds: 10 });
      const result = await compilePromptsForStory([shot], [], [model]);
      expect(result.get('shot-1')).toHaveLength(0);
    });

    test('returns true when model has no maxDurationSeconds', async () => {
      const model = createModel({ maxDurationSeconds: 0 });
      const shot = createShot({ durationSeconds: 999 });
      const result = await compilePromptsForStory([shot], [], [model]);
      expect(result.get('shot-1')).toHaveLength(1);
    });

    test('returns true when shot has no durationSeconds', async () => {
      const model = createModel({ maxDurationSeconds: 5 });
      const shot = createShot({ durationSeconds: 0 });
      const result = await compilePromptsForStory([shot], [], [model]);
      expect(result.get('shot-1')).toHaveLength(1);
    });
  });

  // ==========================================
  // compilePrompt — sanitizer warnings branch
  // ==========================================
  describe('compilePrompt — sanitizer warnings', () => {
    test('logs warnings when sanitizer produces warnings', async () => {
      const { sanitizePrompt } = require('../../../src/sanitizer/promptSanitizer');
      sanitizePrompt.mockReturnValueOnce({
        sanitized: 'safe prompt',
        piiFound: true,
        injectionsFound: false,
        warnings: ['PII detected: email'],
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await compilePrompt(mockShot, [], mockModel);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sanitizer warnings'),
        expect.arrayContaining(['PII detected: email'])
      );
      consoleSpy.mockRestore();
    });

    test('no warnings logged when sanitizer returns empty warnings', async () => {
      const { sanitizePrompt } = require('../../../src/sanitizer/promptSanitizer');
      sanitizePrompt.mockReturnValueOnce({
        sanitized: 'safe prompt',
        piiFound: false,
        injectionsFound: false,
        warnings: [],
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await compilePrompt(mockShot, [], mockModel);
      // The warnings.length > 0 branch should not be entered
      // So no call with 'sanitizer warnings'
      const warningsCalls = (consoleSpy.mock.calls as any[]).filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('sanitizer warnings')
      );
      expect(warningsCalls).toHaveLength(0);
      consoleSpy.mockRestore();
    });
  });

  // ==========================================
  // getDurationParamKey (direct)
  // ==========================================
  describe('getDurationParamKey', () => {
    test('returns model-specific key for known model', () => {
      expect(getDurationParamKey('veo3-low')).toBe('duration_seconds');
      expect(getDurationParamKey('runway-gen3')).toBe('duration');
    });

    test('returns default duration for unknown model', () => {
      expect(getDurationParamKey('unknown-model')).toBe('duration');
    });
  });

  // ==========================================
  // truncatePrompt (direct)
  // ==========================================
  describe('truncatePrompt — direct', () => {
    test('returns prompt unchanged when already within maxLength', () => {
      const result = truncatePrompt('short prompt', 1000);
      expect(result).toBe('short prompt');
    });

    test('truncates when prompt exceeds maxLength', () => {
      const result = truncatePrompt('First sentence. Second sentence. Third sentence.', 20);
      expect(result.length).toBeLessThanOrEqual(20);
    });
  });

  // ==========================================
  // truncatePrompt (via compilePrompt)
  // ==========================================
  describe('truncatePrompt', () => {
    test('truncates long prompt to fit maxPromptLength', async () => {
      const longShot = createShot({
        visualDescription: 'A '.repeat(3000),
      });
      const result = await compilePrompt(longShot, [], mockModel, { maxPromptLength: 500 });
      expect(result.prompt.length).toBeLessThanOrEqual(500);
    });

    test('does not truncate short prompt', async () => {
      const result = await compilePrompt(mockShot, [], mockModel, { maxPromptLength: 50000 });
      expect(result.prompt).toContain('John walks through a forest at sunset');
    });

    test('truncatePrompt returns prompt unchanged when already within maxLength', async () => {
      const result = await compilePrompt(mockShot, [], mockModel, { maxPromptLength: 200 });
      expect(result.prompt).toContain('John walks through a forest at sunset');
    });

    test('truncatePrompt handles prompt with no good sentence breaks', async () => {
      // A long string with no spaces, forcing hard split
      const noSpaceShot = createShot({
        visualDescription: 'A'.repeat(2000),
      });
      const result = await compilePrompt(noSpaceShot, [], mockModel, { maxPromptLength: 100 });
      expect(result.prompt.length).toBeLessThanOrEqual(100);
    });

    test('truncatePrompt handles prompt that needs sentence-level splitting', async () => {
      const shot = createShot({
        visualDescription: 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.',
      });
      const result = await compilePrompt(shot, [], mockModel, { maxPromptLength: 80 });
      expect(result.prompt.length).toBeLessThanOrEqual(80);
    });
  });

  // ==========================================
  // compilePrompt — modelParams alias
  // ==========================================
  describe('compilePrompt — modelParams alias', () => {
    test('modelParams is aliased to parameters', async () => {
      const result = await compilePrompt(mockShot, [], mockModel);
      expect(result.modelParams).toEqual(result.parameters);
    });
  });
});
