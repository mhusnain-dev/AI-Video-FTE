/**
 * Unit tests for Prompt Compiler (Phase 4.1)
 */

import { compilePrompt, compilePromptsForStory, validatePromptForModel } from '../../../src/generation/promptCompiler';
import type { ShotPlan, CharacterRegistryEntry, ModelCapabilities, CompiledPrompt } from '../../../src/shared/types';

jest.mock('../../../src/shared/config', () => ({
  config: {
    faceLock: {
      perModelCharacterThresholds: {},
      defaultPerModelThresholds: {
        'veo3-low': 0.75,
        'veo3-high': 0.80,
        'runway-gen3': 0.85,
        'luma-ray2': 0.78,
      },
      maxRetries: 3,
      perModelCharacterRetries: {},
    },
  },
}));

describe('Prompt Compiler', () => {
  const mockCharacter: CharacterRegistryEntry = {
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
  };

  const mockShot: ShotPlan = {
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
  };

  const mockModel: ModelCapabilities = {
    id: 'veo3-low',
    name: 'Veo 3 Low Quality',
    provider: 'google',
    maxResolution: '720p',
    maxDurationSeconds: 10,
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportedRegions: ['us', 'eu'],
    costPerSecondUsd: 0.00,
    costCurrency: 'USD',
    capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
    defaultTimeoutSeconds: 120,
  };

  // Helper to create a mock character with modified properties
  const createCharacter = (overrides: Partial<CharacterRegistryEntry> = {}): CharacterRegistryEntry => ({
    ...mockCharacter,
    ...overrides,
  });

  // Helper to create a mock shot with modifications
  const createShot = (overrides: Partial<ShotPlan> = {}): ShotPlan => ({
    ...mockShot,
    ...overrides,
  });

  describe('compilePrompt', () => {
    test('builds base prompt from shot visualDescription', async () => {
      const result = await compilePrompt(mockShot, [mockCharacter], mockModel);

      expect(result.prompt).toContain('John walks through a forest at sunset');
      expect(result.prompt).toContain('Camera: static');
      expect(result.prompt).toContain('Duration: 8 seconds');
      expect(result.prompt).toContain('Objects: forest, sunset');
      expect(result.prompt).toContain('Actions: walking');
    });

    test('includes Face-Lock conditioning for character', async () => {
      const result = await compilePrompt(
        mockShot,
        [mockCharacter],
        mockModel
      );

      expect(result.characterConditioning).toHaveLength(1);
      expect(result.characterConditioning[0].characterName).toBe('John');
      expect(result.characterConditioning[0].referenceImageBase64).toBe('hash-123');
      expect(result.characterConditioning[0].modelSpecificParams.subject_reference).toBeDefined();
    });

    test('includes model-specific Veo 3 Face-Lock params', async () => {
      const result = await compilePrompt(
        mockShot,
        [mockCharacter],
        mockModel
      );

      expect(result.characterConditioning[0].modelSpecificParams.subject_reference).toBeDefined();
      expect(result.characterConditioning[0].modelSpecificParams.subject_strength).toBeDefined();
      expect(result.characterConditioning[0].modelSpecificParams.consistency_guidance).toBe(true);
    });

    test('maps parameters to Veo 3 format', async () => {
      const result = await compilePrompt(mockShot, [mockCharacter], mockModel);

      expect(result.parameters.duration_seconds).toBe(8);
      // Resolution is '720p' in ModelCapabilities
      expect(result.parameters.output_resolution).toBe('720p');
      expect(result.parameters.aspect_ratio).toBeDefined();
      expect(result.parameters.fps).toBeDefined();
    });

    test('builds negative prompt', async () => {
      const result = await compilePrompt(mockShot, [mockCharacter], mockModel);

      expect(result.negativePrompt).toContain('blurry');
      expect(result.negativePrompt).toContain('low quality');
      expect(result.negativePrompt).toContain('static camera');
    });

    test('handles shot without characters', async () => {
      const shotWithoutChar: ShotPlan = {
        ...mockShot,
        id: 'shot-2',
        characters: [],
        visualDescription: 'A beautiful forest landscape',
      };

      const result = await compilePrompt(shotWithoutChar, [mockCharacter], mockModel);

      expect(result.characterConditioning).toHaveLength(0);
    });

    test('truncates long prompts', async () => {
      const longShot: ShotPlan = {
        ...mockShot,
        visualDescription: 'A'.repeat(5000),
      };

      const result = await compilePrompt(longShot, [mockCharacter], mockModel, { maxPromptLength: 100 });

      expect(result.prompt.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Model-specific parameter mapping', () => {
    test('maps for Runway Gen-3', async () => {
      const runwayModel: ModelCapabilities = {
        ...mockModel,
        id: 'runway-gen3',
        name: 'Runway Gen-3',
        maxResolution: '1080p',
      };

      const result = await compilePrompt(mockShot, [mockCharacter], runwayModel);

      expect(result.characterConditioning[0].modelSpecificParams.reference_images).toEqual(expect.arrayContaining(['hash-123']));
      expect(result.characterConditioning[0].modelSpecificParams.reference_strength).toBeDefined();
      expect(result.characterConditioning[0].modelSpecificParams.motion_bucket).toBe(50);
    });

    test('maps for Pika', async () => {
      const pikaModel: ModelCapabilities = {
        ...mockModel,
        id: 'pika-1.5',
        name: 'Pika 1.5',
      };

      const result = await compilePrompt(mockShot, [mockCharacter], pikaModel);

      expect(result.characterConditioning[0].modelSpecificParams.character_reference).toBeDefined();
      expect(result.characterConditioning[0].modelSpecificParams.character_weight).toBeDefined();
    });

    test('maps for Kling', async () => {
      const klingModel: ModelCapabilities = {
        ...mockModel,
        id: 'kling-v1',
        name: 'Kling v1',
      };

      const result = await compilePrompt(mockShot, [mockCharacter], klingModel);

      expect(result.characterConditioning[0].modelSpecificParams.image_reference).toBeDefined();
      expect(result.characterConditioning[0].modelSpecificParams.subject_consistency).toBeDefined();
    });
  });

  describe('compilePromptsForStory', () => {
    test('compiles prompts for multiple shots', async () => {
      const shots: ShotPlan[] = [
        mockShot,
        createShot({ id: 'shot-2', order: 2, visualDescription: 'John sits by a river' }),
      ];
      const models = [mockModel];

      const result = await compilePromptsForStory(shots, [mockCharacter], models);

      expect(result.size).toBe(2);
      expect(result.get('shot-1')).toHaveLength(1);
      expect(result.get('shot-2')).toHaveLength(1);
    });

    test('filters models by shot requirements', async () => {
      const longShot: ShotPlan = {
        ...mockShot,
        id: 'shot-long',
        durationSeconds: 20, // Exceeds Veo 3 max of 10
      };

      const models = [mockModel];

      const result = await compilePromptsForStory([longShot], [mockCharacter], models);

      // Should not include Veo 3 for 20s shot
      expect(result.get('shot-long')).toHaveLength(0);
    });
  });

  describe('validatePromptForModel', () => {
    test('validates prompt length', async () => {
      const longPrompt = 'A'.repeat(5000);
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: longPrompt,
        parameters: { duration_seconds: 5 },
        modelParams: { duration_seconds: 5 },
        characterConditioning: [],
        styleReferences: [],
      };

      const result = validatePromptForModel(compiled, mockModel);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i: string) => i.includes('exceeds 4000 chars'))).toBe(true);
    });

    test('validates Face-Lock support', async () => {
      const modelNoImageToVideo: ModelCapabilities = {
        ...mockModel,
        capabilities: ['text_to_video'], // No image_to_video
      };

      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: {},
        modelParams: {},
        characterConditioning: [{
          characterName: 'John',
          referenceImageBase64: 'base64-data',
          modelSpecificParams: {},
        }],
        styleReferences: [],
      };

      const result = validatePromptForModel(compiled, modelNoImageToVideo);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i: string) => i.includes("doesn't support image-to-video"))).toBe(true);
    });

    test('validates duration limits', async () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'Test',
        parameters: { duration_seconds: 15 }, // Exceeds 10s max
        modelParams: { duration_seconds: 15 },
        characterConditioning: [],
        styleReferences: [],
      };

      const result = validatePromptForModel(compiled, mockModel);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i: string) => i.includes('exceeds model max'))).toBe(true);
    });

    test('passes valid prompt', async () => {
      const compiled: CompiledPrompt = {
        modelId: 'veo3-low',
        shotId: 'shot-1',
        prompt: 'A short prompt',
        parameters: { duration_seconds: 5 },
        modelParams: { duration_seconds: 5 },
        characterConditioning: [],
        styleReferences: [],
      };

      const result = validatePromptForModel(compiled, mockModel);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    // Task 40: Multi-character Face-Lock Scenes (FR-026, AC-022)
    describe('Multi-character Face-Lock support', () => {
      const mockCharacter2: CharacterRegistryEntry = {
        ...mockCharacter,
        id: 'char-2',
        name: 'Jane',
        referenceImageHash: 'hash-456',
        metadata: { identityStrength: 0.85 },
      };

      const multiCharacterShot: ShotPlan = {
        ...mockShot,
        id: 'shot-multi',
        characters: ['John', 'Jane'],
        visualDescription: 'John and Jane walk through a forest together',
      };

      test('builds conditioning for multiple characters in shot', async () => {
        const result = await compilePrompt(
          multiCharacterShot,
          [mockCharacter, mockCharacter2],
          mockModel
        );

        expect(result.characterConditioning).toHaveLength(2);
        expect(result.characterConditioning[0].characterName).toBe('John');
        expect(result.characterConditioning[1].characterName).toBe('Jane');
        expect(result.characterConditioning[0].referenceImageBase64).toBe('hash-123');
        expect(result.characterConditioning[1].referenceImageBase64).toBe('hash-456');
      });

      test('includes model-specific params for each character', async () => {
        const result = await compilePrompt(
          multiCharacterShot,
          [mockCharacter, mockCharacter2],
          mockModel
        );

        // Both characters should have Veo 3 specific params
        expect(result.characterConditioning[0].modelSpecificParams.subject_reference).toBeDefined();
        expect(result.characterConditioning[0].modelSpecificParams.subject_strength).toBeDefined();
        expect(result.characterConditioning[1].modelSpecificParams.subject_reference).toBeDefined();
        expect(result.characterConditioning[1].modelSpecificParams.subject_strength).toBeDefined();
      });

      test('handles different identity strengths per character', async () => {
        const strongChar: CharacterRegistryEntry = {
          ...mockCharacter,
          id: 'char-strong',
          name: 'Strong',
          referenceImageHash: 'hash-strong',
          metadata: { identityStrength: 0.95 },
        };

        const weakChar: CharacterRegistryEntry = {
          ...mockCharacter,
          id: 'char-weak',
          name: 'Weak',
          referenceImageHash: 'hash-weak',
          metadata: { identityStrength: 0.5 },
        };

        const shot: ShotPlan = {
          ...mockShot,
          id: 'shot-strength',
          characters: ['Strong', 'Weak'],
          visualDescription: 'Strong and Weak characters',
        };

        const result = await compilePrompt(shot, [strongChar, weakChar], mockModel);

        // Check each character gets its own identity strength
        expect(result.characterConditioning[0].modelSpecificParams.subject_strength).toBe(0.95);
        expect(result.characterConditioning[1].modelSpecificParams.subject_strength).toBe(0.5);
      });

      test('only includes characters referenced in shot', async () => {
        const extraChar: CharacterRegistryEntry = {
          ...mockCharacter,
          id: 'char-extra',
          name: 'Extra',
          referenceImageHash: 'hash-extra',
        };

        // Shot only references John and Jane, not Extra
        const result = await compilePrompt(
          multiCharacterShot,
          [mockCharacter, mockCharacter2, extraChar],
          mockModel
        );

        expect(result.characterConditioning).toHaveLength(2);
        expect(result.characterConditioning.map(c => c.characterName)).toEqual(['John', 'Jane']);
      });

      test('validates multi-character Face-Lock support', async () => {
        const modelNoImageToVideo: ModelCapabilities = {
          ...mockModel,
          capabilities: ['text_to_video'], // No image_to_video
        };

        const compiled: CompiledPrompt = {
          modelId: 'veo3-low',
          shotId: 'shot-1',
          prompt: 'Test',
          parameters: {},
          modelParams: {},
          characterConditioning: [
            {
              characterName: 'John',
              referenceImageBase64: 'base64-data-1',
              modelSpecificParams: {},
            },
            {
              characterName: 'Jane',
              referenceImageBase64: 'base64-data-2',
              modelSpecificParams: {},
            },
          ],
          styleReferences: [],
        };

        const result = validatePromptForModel(compiled, modelNoImageToVideo);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i: string) => i.includes("doesn't support image-to-video"))).toBe(true);
      });

      test('works with Runway Gen-3 multi-character params', async () => {
        const runwayModel: ModelCapabilities = {
          ...mockModel,
          id: 'runway-gen3',
          name: 'Runway Gen-3',
          maxResolution: '1080p',
        };

        const result = await compilePrompt(
          multiCharacterShot,
          [mockCharacter, mockCharacter2],
          runwayModel
        );

        expect(result.characterConditioning).toHaveLength(2);
        // Runway uses reference_images array
        expect(result.characterConditioning[0].modelSpecificParams.reference_images).toEqual(
          expect.arrayContaining(['hash-123'])
        );
        expect(result.characterConditioning[1].modelSpecificParams.reference_images).toEqual(
          expect.arrayContaining(['hash-456'])
        );
        expect(result.characterConditioning[0].modelSpecificParams.motion_bucket).toBe(50);
        expect(result.characterConditioning[1].modelSpecificParams.motion_bucket).toBe(50);
      });

      test('works with Pika multi-character params', async () => {
        const pikaModel: ModelCapabilities = {
          ...mockModel,
          id: 'pika-1.5',
          name: 'Pika 1.5',
        };

        const result = await compilePrompt(
          multiCharacterShot,
          [mockCharacter, mockCharacter2],
          pikaModel
        );

        expect(result.characterConditioning).toHaveLength(2);
        expect(result.characterConditioning[0].modelSpecificParams.character_reference).toBeDefined();
        expect(result.characterConditioning[0].modelSpecificParams.character_weight).toBeDefined();
        expect(result.characterConditioning[1].modelSpecificParams.character_reference).toBeDefined();
        expect(result.characterConditioning[1].modelSpecificParams.character_weight).toBeDefined();
      });
    });
  });
});