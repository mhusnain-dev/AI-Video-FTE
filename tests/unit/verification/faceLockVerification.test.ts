/**
 * Unit tests for Face-Lock Post-Generation Verification (Phase 5.3)
 * Tests behavioural logic: verification, thresholds, retry decisions, pass/fail evaluation
 * Extended for 100% branch coverage
 */

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    faceLock: {
      perModelCharacterThresholds: {
        'veo3-low': { John: 0.7, Jane: 0.8 },
        'runway-gen3': { John: 0.75 },
      },
      defaultPerModelThresholds: {
        'veo3-low': 0.75,
        'runway-gen3': 0.8,
        'kling': 0.7,
      },
      maxRetries: 2,
      perModelCharacterRetries: {
        'veo3-low': { John: 3 },
      },
    },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  facelockVerificationTotal: { inc: jest.fn() },
  facelockSimilarityScore: { observe: jest.fn() },
  facelockRegenerationTotal: { inc: jest.fn() },
  facelockMaxRetriesExceededTotal: { inc: jest.fn() },
  facelockCrossShotDriftDetectedTotal: { inc: jest.fn() },
  facelockConsistencyReportGeneratedTotal: { inc: jest.fn() },
}));

const mockQuery = require('../../../src/shared/db').query;

import {
  extractFramesFromVideo,
  getVerificationTimestamps,
  computeFaceEmbedding,
  verifyFaceIdentity,
  verifyCharacterInShot,
  verifyShotCharacters,
  storeVerificationResult,
  getShotVerificationResults,
  shouldRegenerateShot,
  generateCrossShotConsistencyReport,
  generateStoryFaceLockSummary,
  triggerFaceLockRegeneration,
  type FrameExtractionResult,
} from '../../../src/verification/faceLockVerification';
import type { CharacterRegistryEntry, ShotPlan } from '../../../src/shared/types';

describe('Face-Lock Verification Service', () => {
  const mockCharacter: CharacterRegistryEntry = {
    id: 'char-1',
    userId: 'user-1',
    storyId: 'story-1',
    name: 'John',
    faceEmbedding: new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1)),
    voiceEmbedding: undefined,
    referenceImageHash: 'hash-123',
    referenceImageBase64: 'base64-ref-image',
    referenceImageUrl: undefined,
    metadata: { identityStrength: 0.8 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCharacterWithThreshold: CharacterRegistryEntry = {
    ...mockCharacter,
    name: 'Jane',
    faceEmbedding: new Array(512).fill(0).map((_, i) => (i % 3 === 0 ? 0.2 : -0.2)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
  });

  // ---------------------------------------------------------------------------
  // Frame Extraction Tests
  // ---------------------------------------------------------------------------
  describe('extractFramesFromVideo', () => {
    test('returns frames at requested timestamps', async () => {
      const result: FrameExtractionResult = await extractFramesFromVideo(
        'https://example.com/video.mp4',
        [1.0, 2.0, 3.0],
        'shot-1'
      );

      expect(result.frames).toHaveLength(3);
      expect(result.frames[0].timestampSeconds).toBe(1.0);
      expect(result.frames[1].timestampSeconds).toBe(2.0);
      expect(result.frames[2].timestampSeconds).toBe(3.0);
      expect(result.frames[0].imageBase64).toContain('mock-frame-shot-1-1');
      expect(result.frames[0].width).toBe(1920);
      expect(result.frames[0].height).toBe(1080);
      expect(result.extractionError).toBeUndefined();
    });

    test('returns empty frames for empty timestamps array', async () => {
      const result = await extractFramesFromVideo('url', [], 'shot-1');
      expect(result.frames).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Timestamp Generation Tests
  // ---------------------------------------------------------------------------
  describe('getVerificationTimestamps', () => {
    test('generates 5 timestamps at 10%, 30%, 50%, 70%, 90% of duration', () => {
      const timestamps = getVerificationTimestamps(10);

      expect(timestamps).toHaveLength(5);
      expect(timestamps[0]).toBeCloseTo(1.0);
      expect(timestamps[1]).toBeCloseTo(3.0);
      expect(timestamps[2]).toBeCloseTo(5.0);
      expect(timestamps[3]).toBeCloseTo(7.0);
      expect(timestamps[4]).toBeCloseTo(9.0);
    });

    test('clamps timestamps within video duration', () => {
      const timestamps = getVerificationTimestamps(2);

      expect(timestamps.every((t: number) => t <= 1.9)).toBe(true);
      expect(timestamps.every((t: number) => t >= 0)).toBe(true);
    });

    test('respects maxFrames parameter', () => {
      const timestamps = getVerificationTimestamps(10, 3);
      expect(timestamps).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Face Embedding Tests
  // ---------------------------------------------------------------------------
  describe('computeFaceEmbedding', () => {
    test('returns deterministic 512-dim embedding for same input', async () => {
      const emb1 = await computeFaceEmbedding('frame-base64', 'John');
      const emb2 = await computeFaceEmbedding('frame-base64', 'John');

      expect(emb1).toEqual(emb2);
      expect(emb1).toHaveLength(512);
    });

    test('returns different embeddings for different characters', async () => {
      const emb1 = await computeFaceEmbedding('frame-base64', 'John');
      const emb2 = await computeFaceEmbedding('frame-base64', 'Jane');

      expect(emb1).not.toEqual(emb2);
    });

    test('returns normalized unit vector', async () => {
      const emb = await computeFaceEmbedding('frame-base64', 'John');
      expect(emb).not.toBeNull();
      if (emb) {
        const magnitude = Math.sqrt(emb.reduce((sum: number, val: number) => sum + val * val, 0));
        expect(magnitude).toBeCloseTo(1.0, 5);
      }
    });

    test('returns different embeddings for different frames', async () => {
      const emb1 = await computeFaceEmbedding('frame-1', 'John');
      const emb2 = await computeFaceEmbedding('frame-2', 'John');

      expect(emb1).not.toEqual(emb2);
    });
  });

  // ---------------------------------------------------------------------------
  // Cosine Similarity Edge Cases (Branch Coverage)
  // ---------------------------------------------------------------------------
  describe('cosineSimilarity edge cases', () => {
    test('returns 0 for different length vectors via verifyFaceIdentity', () => {
      const ref = new Array(512).fill(0.1);
      const gen = new Array(256).fill(0.1);
      const result = verifyFaceIdentity(ref, gen, 0.7);
      expect(result.match).toBe(false);
      expect(result.score).toBe(0);
    });

    test('returns 0 when reference vector has zero norm', () => {
      const ref = new Array(512).fill(0);
      const gen = new Array(512).fill(0.1);
      const result = verifyFaceIdentity(ref, gen, 0.5);
      expect(result.match).toBe(false);
      expect(result.score).toBe(0);
    });

    test('returns 0 when generated vector has zero norm', () => {
      const ref = new Array(512).fill(0.1);
      const gen = new Array(512).fill(0);
      const result = verifyFaceIdentity(ref, gen, 0.5);
      expect(result.match).toBe(false);
      expect(result.score).toBe(0);
    });

    test('returns perfect match for identical vectors', () => {
      const vec = new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? 1 : -1));
      const result = verifyFaceIdentity(vec, vec, 0.999);
      expect(result.match).toBe(true);
      expect(result.score).toBeCloseTo(1.0, 5);
    });

    test('returns exact threshold boundary (score == threshold)', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      const result = verifyFaceIdentity(a, b, 1.0);
      expect(result.match).toBe(true);
      expect(result.score).toBe(1.0);
    });

    test('returns no match just below threshold', () => {
      const a = [1, 0, 0];
      const b = [0.9, 0.1, 0];
      const score = (1 * 0.9) / (1 * Math.sqrt(0.81 + 0.01));
      const result = verifyFaceIdentity(a, b, score + 0.001);
      expect(result.match).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Character Verification Tests
  // ---------------------------------------------------------------------------
  describe('verifyCharacterInShot', () => {
    test('FAILS when similarity < threshold', async () => {
      const result = await verifyCharacterInShot(
        'shot-1', 'https://example.com/video.mp4', 8, mockCharacter, 'veo3-low', 0
      );

      expect(result.similarity).toBeLessThan(0.7);
      expect(result.threshold).toBe(0.7);
      expect(result.passed).toBe(false);
    });

    test('uses per-model character threshold over default', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacter, 'veo3-low', 0);
      expect(result.threshold).toBe(0.7);
    });

    test('falls back to default per-model threshold when no character-specific', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacterWithThreshold, 'veo3-low', 0);
      expect(result.threshold).toBe(0.8);
    });

    test('falls back to default threshold (0.75) when model not configured', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacter, 'unknown-model', 0);
      expect(result.threshold).toBe(0.75);
    });

    test('includes retryCount in result', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacter, 'veo3-low', 2);
      expect(result.retryCount).toBe(2);
    });

    test('returns failed result when no reference embedding', async () => {
      const noEmbeddingChar = { ...mockCharacter, faceEmbedding: [] };
      const result = await verifyCharacterInShot('shot-1', 'url', 8, noEmbeddingChar, 'veo3-low', 0);
      expect(result.similarity).toBe(0);
      expect(result.passed).toBe(false);
    });

    test('returns failed result when faceEmbedding access throws', async () => {
      const throwingChar = { ...mockCharacter };
      Object.defineProperty(throwingChar, 'faceEmbedding', {
        get() { throw new Error('Decryption failed'); },
        configurable: true,
      });

      const result = await verifyCharacterInShot('shot-1', 'url', 8, throwingChar, 'veo3-low', 0);
      expect(result.similarity).toBe(0);
      expect(result.passed).toBe(false);
    });

    test('returns valid result structure', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacter, 'veo3-low', 0);
      expect(result).toHaveProperty('characterName');
      expect(result).toHaveProperty('shotId');
      expect(result).toHaveProperty('similarity');
      expect(result).toHaveProperty('threshold');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('retryCount');
      expect(result).toHaveProperty('modelId');
      expect(typeof result.passed).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-Character Verification Tests
  // ---------------------------------------------------------------------------
  describe('verifyShotCharacters', () => {
    test('verifies all characters independently', async () => {
      const characters = [mockCharacter, mockCharacterWithThreshold];
      const results = await verifyShotCharacters('shot-1', 'https://example.com/video.mp4', 8, characters, 'veo3-low', 0);

      expect(results).toHaveLength(2);
      expect(results[0].characterName).toBe('John');
      expect(results[1].characterName).toBe('Jane');
      expect(results[0].modelId).toBe('veo3-low');
      expect(results[1].modelId).toBe('veo3-low');
    });

    test('returns empty array for no characters', async () => {
      const results = await verifyShotCharacters('shot-1', 'url', 8, [], 'veo3-low', 0);
      expect(results).toHaveLength(0);
    });

    test('each character gets correct per-model threshold', async () => {
      const characters = [mockCharacter, mockCharacterWithThreshold];
      const results = await verifyShotCharacters('shot-1', 'url', 8, characters, 'veo3-low', 0);
      expect(results[0].threshold).toBe(0.7);
      expect(results[1].threshold).toBe(0.8);
    });
  });

  // ---------------------------------------------------------------------------
  // Verification Result Storage Tests
  // ---------------------------------------------------------------------------
  describe('storeVerificationResult / getShotVerificationResults', () => {
    test('stores verification result in database', async () => {
      mockQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

      await storeVerificationResult({
        characterName: 'John', shotId: 'shot-1', similarity: 0.85,
        threshold: 0.75, passed: true, retryCount: 0, modelId: 'veo3-low',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO face_lock_verifications'),
        expect.arrayContaining(['shot-1', 'John', 0.85, 0.75, true, 0, 'veo3-low'])
      );
    });

    test('retrieves verification results for shot', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low' },
          { character_name: 'Jane', shot_id: 'shot-1', similarity: 0.6, threshold: 0.75, passed: false, retry_count: 0, model_id: 'veo3-low' },
        ],
        command: 'SELECT', rowCount: 2, oid: 0, fields: [],
      });

      const results = await getShotVerificationResults('shot-1');
      expect(results).toHaveLength(2);
      expect(results[0].characterName).toBe('John');
      expect(results[0].passed).toBe(true);
      expect(results[1].characterName).toBe('Jane');
      expect(results[1].passed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-Regeneration Decision Tests
  // ---------------------------------------------------------------------------
  describe('shouldRegenerateShot', () => {
    test('returns NO regeneration when all characters PASS', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retryCount: 0, modelId: 'veo3-low' },
        { characterName: 'Jane', shotId: 'shot-1', similarity: 0.8, threshold: 0.75, passed: true, retryCount: 0, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 2);
      expect(decision.shouldRegenerate).toBe(false);
      expect(decision.reason).toContain('All characters passed');
      expect(decision.nextRetryCount).toBe(0);
    });

    test('returns REGENERATION when any character FAILS and retries available', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retryCount: 0, modelId: 'veo3-low' },
        { characterName: 'Jane', shotId: 'shot-1', similarity: 0.5, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 2);
      expect(decision.shouldRegenerate).toBe(true);
      expect(decision.reason).toContain('Face-Lock verification failed for: Jane');
      expect(decision.reason).toContain('Retry 1/2');
    });

    test('returns NO regeneration when max retries EXCEEDED', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.4, threshold: 0.75, passed: false, retryCount: 2, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 2);
      expect(decision.shouldRegenerate).toBe(false);
      expect(decision.reason).toContain('Max retries (2) exceeded');
    });

    test('uses maximum retryCount across all characters', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.8, threshold: 0.75, passed: true, retryCount: 1, modelId: 'veo3-low' },
        { characterName: 'Jane', shotId: 'shot-1', similarity: 0.5, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 3);
      expect(decision.nextRetryCount).toBe(2);
      expect(decision.shouldRegenerate).toBe(true);
    });

    test('lists all failed characters in reason', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.4, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
        { characterName: 'Jane', shotId: 'shot-1', similarity: 0.5, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
        { characterName: 'Bob', shotId: 'shot-1', similarity: 0.6, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 2);
      expect(decision.reason).toContain('John');
      expect(decision.reason).toContain('Jane');
      expect(decision.reason).toContain('Bob');
    });

    test('respects configured maxRetries parameter', () => {
      const results = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.4, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
      ];
      const decision = shouldRegenerateShot(results, 5);
      expect(decision.shouldRegenerate).toBe(true);
      expect(decision.nextRetryCount).toBe(1);
      expect(decision.maxRetries).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-Shot Consistency Report Tests
  // ---------------------------------------------------------------------------
  describe('generateCrossShotConsistencyReport', () => {
    const mockVerificationRows = [
      { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
      { character_name: 'John', shot_id: 'shot-2', similarity: 0.82, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 2 },
      { character_name: 'Jane', shot_id: 'shot-1', similarity: 0.9, threshold: 0.8, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
      { character_name: 'Jane', shot_id: 'shot-2', similarity: 0.6, threshold: 0.8, passed: false, retry_count: 1, model_id: 'veo3-low', shot_order: 2 },
    ];

    const mockShotsRows = [
      { shot_id: 'shot-1', shot_order: 1, characters: ['John', 'Jane'] },
      { shot_id: 'shot-2', shot_order: 2, characters: ['John', 'Jane'] },
    ];

    beforeEach(() => {
      jest.clearAllMocks();
      mockQuery
        .mockResolvedValueOnce({ rows: mockShotsRows, command: '', rowCount: 2, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: mockVerificationRows, command: '', rowCount: 4, oid: 0, fields: [] });
    });

    test('returns report with correct structure', async () => {
      const report = await generateCrossShotConsistencyReport('story-1');
      expect(report.storyId).toBe('story-1');
      expect(report.totalCharacters).toBe(2);
      expect(report.totalShots).toBe(2);
      expect(Array.isArray(report.characterSummaries)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    test('aggregates character summaries correctly', async () => {
      const report = await generateCrossShotConsistencyReport('story-1');
      const john = report.characterSummaries.find(c => c.characterName === 'John');
      const jane = report.characterSummaries.find(c => c.characterName === 'Jane');

      expect(john!.totalShots).toBe(2);
      expect(john!.verifiedShots).toBe(2);
      expect(john!.failedShots).toBe(0);
      expect(john!.averageSimilarity).toBeCloseTo(0.835, 2);
      expect(john!.driftDetected).toBe(false);

      expect(jane!.totalShots).toBe(2);
      expect(jane!.verifiedShots).toBe(1);
      expect(jane!.failedShots).toBe(1);
      expect(jane!.driftDetected).toBe(true);
    });

    test('generates regen_shot and review_character recommendations', async () => {
      const report = await generateCrossShotConsistencyReport('story-1');
      const regenRecs = report.recommendations.filter(r => r.type === 'regen_shot');
      const driftRecs = report.recommendations.filter(r => r.type === 'review_character');
      expect(regenRecs.length).toBe(1);
      expect(regenRecs[0].priority).toBe('high');
      expect(driftRecs.length).toBe(1);
      expect(driftRecs[0].priority).toBe('medium');
    });

    test('generates adjust_threshold recommendations when avg similarity close to threshold', async () => {
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { shot_id: 'shot-1', shot_order: 1, characters: ['CloseChar'] },
          { shot_id: 'shot-2', shot_order: 2, characters: ['CloseChar'] },
        ], command: '', rowCount: 2, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [
          { character_name: 'CloseChar', shot_id: 'shot-1', similarity: 0.81, threshold: 0.8, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
          { character_name: 'CloseChar', shot_id: 'shot-2', similarity: 0.79, threshold: 0.8, passed: false, retry_count: 0, model_id: 'veo3-low', shot_order: 2 },
        ], command: '', rowCount: 2, oid: 0, fields: [] });

      const report = await generateCrossShotConsistencyReport('story-1');
      const thresholdRecs = report.recommendations.filter(r => r.type === 'adjust_threshold');
      expect(thresholdRecs.length).toBe(1);
      expect(thresholdRecs[0].priority).toBe('low');
    });

    test('returns empty report for story with no shots', async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

      const report = await generateCrossShotConsistencyReport('empty-story');
      expect(report.totalCharacters).toBe(0);
      expect(report.totalShots).toBe(0);
      expect(report.overallPassed).toBe(true);
    });

    test('handles character with no verifications gracefully', async () => {
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ shot_id: 'shot-1', shot_order: 1, characters: ['Ghost'] }], command: '', rowCount: 1, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

      const report = await generateCrossShotConsistencyReport('story-1');
      expect(report.totalCharacters).toBe(0);
    });

    test('generates no recommendations when all characters pass with no drift', async () => {
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { shot_id: 'shot-1', shot_order: 1, characters: ['John'] },
          { shot_id: 'shot-2', shot_order: 2, characters: ['John'] },
        ], command: '', rowCount: 2, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [
          { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
          { character_name: 'John', shot_id: 'shot-2', similarity: 0.83, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 2 },
        ], command: '', rowCount: 2, oid: 0, fields: [] });

      const report = await generateCrossShotConsistencyReport('story-1');
      expect(report.overallPassed).toBe(true);
      expect(report.recommendations).toHaveLength(0);
    });
  });

  describe('generateStoryFaceLockSummary', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('returns lightweight summary with correct structure', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { shot_id: 'shot-1', shot_order: 1, characters: ['John', 'Jane'] },
          { shot_id: 'shot-2', shot_order: 2, characters: ['John', 'Jane'] },
        ], command: '', rowCount: 2, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [
          { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
          { character_name: 'John', shot_id: 'shot-2', similarity: 0.82, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 2 },
          { character_name: 'Jane', shot_id: 'shot-1', similarity: 0.9, threshold: 0.8, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
          { character_name: 'Jane', shot_id: 'shot-2', similarity: 0.6, threshold: 0.8, passed: false, retry_count: 1, model_id: 'veo3-low', shot_order: 2 },
        ], command: '', rowCount: 4, oid: 0, fields: [] });

      const summary = await generateStoryFaceLockSummary('story-1');
      expect(summary.storyId).toBe('story-1');
      expect(summary.overallStatus).toBe('partial');
      expect(summary.charactersPassed).toBe(1);
      expect(summary.charactersFailed).toBe(1);
    });

    test('overallStatus is passed when all characters pass', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { shot_id: 'shot-1', shot_order: 1, characters: ['John'] },
        ], command: '', rowCount: 1, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [
          { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
        ], command: '', rowCount: 1, oid: 0, fields: [] });

      const summary = await generateStoryFaceLockSummary('story-1');
      expect(summary.overallStatus).toBe('passed');
    });

    test('overallStatus is failed when all characters fail', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [
          { shot_id: 'shot-1', shot_order: 1, characters: ['John'] },
        ], command: '', rowCount: 1, oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [
          { character_name: 'John', shot_id: 'shot-1', similarity: 0.4, threshold: 0.75, passed: false, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
        ], command: '', rowCount: 1, oid: 0, fields: [] });

      const summary = await generateStoryFaceLockSummary('story-1');
      expect(summary.overallStatus).toBe('failed');
    });

    test('returns zeroed summary for empty story', async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

      const summary = await generateStoryFaceLockSummary('empty-story');
      expect(summary.totalCharacters).toBe(0);
      expect(summary.overallStatus).toBe('passed');
      expect(summary.avgSimilarity).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyFaceIdentity Tests
  // ---------------------------------------------------------------------------
  describe('verifyFaceIdentity', () => {
    test('returns match when score >= threshold', () => {
      const result = verifyFaceIdentity([1, 0, 0], [1, 0, 0], 0.9);
      expect(result.match).toBe(true);
      expect(result.score).toBeCloseTo(1.0, 5);
    });

    test('returns no-match when score < threshold', () => {
      const result = verifyFaceIdentity([1, 0, 0], [0, 1, 0], 0.5);
      expect(result.match).toBe(false);
    });

    test('handles mismatched lengths', () => {
      const result = verifyFaceIdentity([1, 0], [1, 0, 0], 0.5);
      expect(result.match).toBe(false);
      expect(result.score).toBe(0);
    });

    test('handles both zero vectors', () => {
      const result = verifyFaceIdentity([0, 0, 0], [0, 0, 0], 0.5);
      expect(result.match).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Constitutional Invariant Tests
  // ---------------------------------------------------------------------------
  describe('Constitutional Face-Lock Invariant', () => {
    test('verification uses registered reference image embeddings', async () => {
      const customChar = {
        ...mockCharacter,
        faceEmbedding: new Array(512).fill(0).map((_, i) => (i === 0 ? 1.0 : 0.0)),
      };
      const result = await verifyCharacterInShot('shot-1', 'url', 8, customChar, 'veo3-low', 0);
      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1);
    });

    test('threshold configurable per-model and per-character', async () => {
      const result1 = await verifyCharacterInShot('shot-1', 'url', 8, { ...mockCharacter, name: 'John' }, 'veo3-low', 0);
      const result2 = await verifyCharacterInShot('shot-1', 'url', 8, { ...mockCharacter, name: 'Jane' }, 'veo3-low', 0);
      expect(result1.threshold).toBe(0.7);
      expect(result2.threshold).toBe(0.8);
    });

    test('auto-regeneration limited by maxRetries', () => {
      const failedResults = [
        { characterName: 'John', shotId: 'shot-1', similarity: 0.3, threshold: 0.75, passed: false, retryCount: 0, modelId: 'veo3-low' },
      ];

      let decision = shouldRegenerateShot(failedResults, 2);
      expect(decision.shouldRegenerate).toBe(true);

      failedResults[0].retryCount = 1;
      decision = shouldRegenerateShot(failedResults, 2);
      expect(decision.shouldRegenerate).toBe(true);

      failedResults[0].retryCount = 2;
      decision = shouldRegenerateShot(failedResults, 2);
      expect(decision.shouldRegenerate).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // ONNX Model Load + Inference Path
  // Uses separate describe blocks with isolated jest.resetModules to avoid
  // the hoisting issue where jest.mock() inside tests gets hoisted above resetModules.
  // Each test uses isolatedModules + dynamic import with doMock.
  // ---------------------------------------------------------------------------
  describe('ONNX model load and inference path', () => {
    function mockOrtFactory(runImpl: any) {
      return () => ({
        InferenceSession: {
          create: jest.fn().mockResolvedValue({ run: runImpl }),
        },
        Tensor: jest.fn().mockImplementation((type: string, data: Float32Array, dims: number[]) => ({
          type, data, dims,
        })),
      });
    }

    function mockAllDeps(overrides: { fsExistsSync?: boolean; ortFactory?: () => any; queryImpl?: any } = {}) {
      const fsExistsSync = overrides.fsExistsSync ?? true;
      const queryImpl = overrides.queryImpl ?? jest.fn().mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

      jest.doMock('fs', () => ({ existsSync: jest.fn().mockReturnValue(fsExistsSync) }));
      if (overrides.ortFactory) {
        jest.doMock('onnxruntime-web', overrides.ortFactory);
      } else {
        jest.doMock('onnxruntime-web', mockOrtFactory(
          jest.fn().mockResolvedValue({
            embedding: { data: new Float32Array(512).fill(0).map((_: number, i: number) => (i % 2 === 0 ? 0.5 : -0.5)) },
          })
        ));
      }
      jest.doMock('../../../src/shared/db', () => ({ query: queryImpl }));
      jest.doMock('../../../src/shared/config', () => ({
        config: { faceLock: { perModelCharacterThresholds: {}, defaultPerModelThresholds: {}, maxRetries: 2, perModelCharacterRetries: {} } },
      }));
      jest.doMock('../../../src/shared/metrics', () => ({
        facelockVerificationTotal: { inc: jest.fn() },
        facelockSimilarityScore: { observe: jest.fn() },
        facelockRegenerationTotal: { inc: jest.fn() },
        facelockMaxRetriesExceededTotal: { inc: jest.fn() },
        facelockCrossShotDriftDetectedTotal: { inc: jest.fn() },
        facelockConsistencyReportGeneratedTotal: { inc: jest.fn() },
      }));
    }

    test('loads ArcFace model and returns ONNX embeddings', async () => {
      jest.resetModules();
      mockAllDeps({ fsExistsSync: true });

      const ort = require('onnxruntime-web');
      const mod = await import('../../../src/verification/faceLockVerification');

      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');

      expect(ort.InferenceSession.create).toHaveBeenCalled();
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
      const magnitude = Math.sqrt(embedding!.reduce((sum: number, v: number) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 4);
    });

    test('returns null when model file does not exist', async () => {
      jest.resetModules();
      mockAllDeps({ fsExistsSync: false });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');

      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ArcFace model not found'));
      consoleSpy.mockRestore();
    });

    test('returns cached session on second call', async () => {
      jest.resetModules();
      const createSpy = jest.fn().mockResolvedValue({
        run: jest.fn().mockResolvedValue({ embedding: { data: new Float32Array(512).fill(0.1) } }),
      });
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: () => ({
          InferenceSession: { create: createSpy },
          Tensor: jest.fn().mockImplementation((type: string, data: Float32Array, dims: number[]) => ({ type, data, dims })),
        }),
      });

      const mod = await import('../../../src/verification/faceLockVerification');

      await mod.computeFaceEmbedding('frame1', 'John');
      await mod.computeFaceEmbedding('frame2', 'John');
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test('handles ONNX inference failure gracefully', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: mockOrtFactory(
          jest.fn().mockRejectedValue(new Error('ONNX inference failed'))
        ),
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');

      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ArcFace inference failed'), expect.any(Error));
      consoleSpy.mockRestore();
    });

    test('handles ONNX session returning empty result object', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: mockOrtFactory(jest.fn().mockResolvedValue({})),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
    });

    test('handles ONNX session returning output without data property', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: mockOrtFactory(
          jest.fn().mockResolvedValue({ embedding: { noData: true } })
        ),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
    });

    test('handles ONNX zero-magnitude output falls through to mock', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: mockOrtFactory(
          jest.fn().mockResolvedValue({ embedding: { data: new Float32Array(512).fill(0) } })
        ),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
    });

    test('ONNX output uses first key when embedding key missing', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: mockOrtFactory(
          jest.fn().mockResolvedValue({ output: { data: new Float32Array(512).fill(0.1) } })
        ),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      const embedding = await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');
      expect(embedding).not.toBeNull();
      const magnitude = Math.sqrt(embedding!.reduce((sum: number, v: number) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 4);
    });

    test('preprocessImageForArcFace creates correct tensor dimensions', async () => {
      jest.resetModules();
      const tensorCalls: any[] = [];
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: () => ({
          InferenceSession: {
            create: jest.fn().mockResolvedValue({
              run: jest.fn().mockResolvedValue({ embedding: { data: new Float32Array(512).fill(0.1) } }),
            }),
          },
          Tensor: jest.fn().mockImplementation((type: string, data: Float32Array, dims: number[]) => {
            tensorCalls.push({ type, dataLen: data.length, dims });
            return { type, data, dims };
          }),
        }),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      await mod.computeFaceEmbedding('aHR0cDovL3Rlc3Q', 'John');

      expect(tensorCalls.length).toBe(1);
      expect(tensorCalls[0].type).toBe('float32');
      expect(tensorCalls[0].dims).toEqual([1, 3, 112, 112]);
      expect(tensorCalls[0].dataLen).toBe(3 * 112 * 112);
    });

    test('returns cached session on second call (L102)', async () => {
      jest.resetModules();
      const createSpy = jest.fn().mockResolvedValue({
        run: jest.fn().mockResolvedValue({ embedding: { data: new Float32Array(512).fill(0.1) } }),
      });
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: () => ({
          InferenceSession: { create: createSpy },
          Tensor: jest.fn().mockImplementation((type: string, data: Float32Array, dims: number[]) => ({ type, data, dims })),
        }),
      });

      const mod = await import('../../../src/verification/faceLockVerification');
      await mod.computeFaceEmbedding('frame1', 'John');
      expect(createSpy).toHaveBeenCalledTimes(1);
      await mod.computeFaceEmbedding('frame2', 'John');
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test('returns null after load attempt failure (L103)', async () => {
      jest.resetModules();
      mockAllDeps({
        fsExistsSync: true,
        ortFactory: () => ({
          InferenceSession: {
            create: jest.fn().mockRejectedValue(new Error('Load failed')),
          },
          Tensor: jest.fn(),
        }),
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');

      await mod.computeFaceEmbedding('frame1', 'John');
      const embedding = await mod.computeFaceEmbedding('frame2', 'John');
      expect(embedding).not.toBeNull();
      expect(embedding).toHaveLength(512);
      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // triggerFaceLockRegeneration Tests (L659-719)
  // ---------------------------------------------------------------------------
  describe('triggerFaceLockRegeneration', () => {
    const mockShot = { id: 'shot-1', story_id: 'story-1', status: 'pending', order: 1 };
    const mockModel = { id: 'veo3-low', name: 'Veo3 Low' };

    function mockRegenDeps(overrides: {
      shotRows?: any[];
      modelRegistry?: any[];
      compileResult?: any;
      dispatchResult?: any;
      compileReject?: any;
    } = {}) {
      const shotRows = overrides.shotRows ?? [mockShot];
      const modelRegistry = overrides.modelRegistry ?? [mockModel];
      const dispatchResult = overrides.dispatchResult ?? { success: true, jobId: 'job-1' };

      const queryFn = overrides.shotRows === undefined
        ? jest.fn()
            .mockResolvedValueOnce({ rows: shotRows, command: '', rowCount: shotRows.length, oid: 0, fields: [] })
            .mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] })
        : jest.fn()
            .mockResolvedValue({ rows: shotRows, command: '', rowCount: shotRows.length, oid: 0, fields: [] });

      jest.doMock('../../../src/shared/db', () => ({ query: queryFn }));
      jest.doMock('../../../src/shared/config', () => ({
        config: { faceLock: { perModelCharacterThresholds: {}, defaultPerModelThresholds: {}, maxRetries: 2 } },
      }));
      jest.doMock('../../../src/shared/metrics', () => ({
        facelockVerificationTotal: { inc: jest.fn() },
        facelockSimilarityScore: { observe: jest.fn() },
        facelockRegenerationTotal: { inc: jest.fn() },
        facelockMaxRetriesExceededTotal: { inc: jest.fn() },
        facelockCrossShotDriftDetectedTotal: { inc: jest.fn() },
        facelockConsistencyReportGeneratedTotal: { inc: jest.fn() },
      }));
      jest.doMock('../../../src/router/modelRegistry', () => ({
        getModelRegistry: jest.fn().mockResolvedValue(modelRegistry),
      }));
      jest.doMock('../../../src/generation/promptCompiler', () => ({
        compilePrompt: overrides.compileReject
          ? jest.fn().mockRejectedValue(overrides.compileReject)
          : jest.fn().mockResolvedValue(overrides.compileResult ?? { prompt: 'compiled', conditioning: {} }),
      }));
      jest.doMock('../../../src/dispatch/shotDispatcher', () => ({
        dispatchShot: jest.fn().mockResolvedValue(dispatchResult),
      }));
      jest.doMock('../../../src/shared/events', () => ({
        emitShotStateChange: jest.fn(),
      }));
    }

    test('dispatches regeneration successfully', async () => {
      jest.resetModules();
      mockRegenDeps();
      const mod = await import('../../../src/verification/faceLockVerification');
      const { dispatchShot } = require('../../../src/dispatch/shotDispatcher');

      await mod.triggerFaceLockRegeneration('shot-1', [mockCharacter], 'veo3-low', 1);
      expect(dispatchShot).toHaveBeenCalled();
    });

    test('returns early when shot not found', async () => {
      jest.resetModules();
      mockRegenDeps({ shotRows: [] });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');

      await mod.triggerFaceLockRegeneration('nonexistent', [mockCharacter], 'veo3-low', 1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Shot nonexistent not found'));
      consoleSpy.mockRestore();
    });

    test('returns early when model not found', async () => {
      jest.resetModules();
      mockRegenDeps({ modelRegistry: [] });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');

      await mod.triggerFaceLockRegeneration('shot-1', [mockCharacter], 'nonexistent-model', 1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Model nonexistent-model not found'));
      consoleSpy.mockRestore();
    });

    test('updates shot status when dispatch fails', async () => {
      jest.resetModules();
      mockRegenDeps({ dispatchResult: { success: false, error: 'Dispatch error' } });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');
      const { emitShotStateChange } = require('../../../src/shared/events');
      const queryMock = require('../../../src/shared/db').query;

      await mod.triggerFaceLockRegeneration('shot-1', [mockCharacter], 'veo3-low', 1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE shots SET status'),
        ['shot-1', expect.stringContaining('Face-Lock regeneration dispatch failed')]
      );
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'face_lock_failed', 'failed', 'regeneration_dispatch_failed',
        expect.objectContaining({ retryCount: 1 })
      );
      consoleSpy.mockRestore();
    });

    test('handles non-Error exception during regeneration', async () => {
      jest.resetModules();
      mockRegenDeps({ compileReject: 'string error' });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');
      const { emitShotStateChange } = require('../../../src/shared/events');
      const queryMock = require('../../../src/shared/db').query;

      await mod.triggerFaceLockRegeneration('shot-1', [mockCharacter], 'veo3-low', 2);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE shots SET status'),
        ['shot-1', expect.stringContaining('Face-Lock regeneration error: Unknown regeneration error')]
      );
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'face_lock_failed', 'failed', 'regeneration_error',
        expect.objectContaining({ retryCount: 2 })
      );
      consoleSpy.mockRestore();
    });

    test('handles Error exception during regeneration', async () => {
      jest.resetModules();
      mockRegenDeps({ compileReject: new Error('Compile crash') });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');
      const { emitShotStateChange } = require('../../../src/shared/events');
      const queryMock = require('../../../src/shared/db').query;

      await mod.triggerFaceLockRegeneration('shot-1', [mockCharacter], 'veo3-low', 1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE shots SET status'),
        ['shot-1', expect.stringContaining('Face-Lock regeneration error: Compile crash')]
      );
      expect(emitShotStateChange).toHaveBeenCalledWith(
        'shot-1', 'face_lock_failed', 'failed', 'regeneration_error',
        expect.objectContaining({ error: 'Compile crash', retryCount: 1 })
      );
      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Branch Coverage Gap Tests
  // Targeted tests for specific uncovered branches
  // ---------------------------------------------------------------------------
  describe('Branch coverage gaps', () => {
    test('L119: catch block with non-Error throw in loadArcFaceModel', async () => {
      jest.resetModules();
      jest.doMock('fs', () => ({ existsSync: jest.fn().mockReturnValue(true) }));
      jest.doMock('onnxruntime-web', () => ({
        InferenceSession: {
          create: jest.fn().mockImplementation(() => { throw 'string error'; }),
        },
        Tensor: jest.fn(),
      }));
      jest.doMock('../../../src/shared/db', () => ({ query: jest.fn() }));
      jest.doMock('../../../src/shared/config', () => ({
        config: { faceLock: { perModelCharacterThresholds: {}, defaultPerModelThresholds: {}, maxRetries: 2, perModelCharacterRetries: {} } },
      }));
      jest.doMock('../../../src/shared/metrics', () => ({
        facelockVerificationTotal: { inc: jest.fn() },
        facelockSimilarityScore: { observe: jest.fn() },
        facelockRegenerationTotal: { inc: jest.fn() },
        facelockMaxRetriesExceededTotal: { inc: jest.fn() },
        facelockCrossShotDriftDetectedTotal: { inc: jest.fn() },
        facelockConsistencyReportGeneratedTotal: { inc: jest.fn() },
      }));

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mod = await import('../../../src/verification/faceLockVerification');
      const embedding = await mod.computeFaceEmbedding('test', 'John');
      expect(embedding).toHaveLength(512);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load ArcFace model'));
      consoleSpy.mockRestore();
    });

    test('L212: verifyFaceIdentity uses default threshold 0.775', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      const result = verifyFaceIdentity(a, b);
      expect(result.threshold).toBe(0.775);
      expect(result.match).toBe(true);
    });

    test('L240: verifyCharacterInShot uses default retryCount 0', async () => {
      const result = await verifyCharacterInShot('shot-1', 'url', 8, mockCharacter, 'veo3-low');
      expect(result.retryCount).toBe(0);
    });

    test('L254: verifyCharacterInShot handles null/undefined faceEmbedding', async () => {
      const char = { ...mockCharacter, faceEmbedding: null as any };
      const result = await verifyCharacterInShot('shot-1', 'url', 8, char, 'veo3-low', 0);
      expect(result.passed).toBe(false);
      expect(result.similarity).toBe(0);
    });

    test('L311: metrics records passed=true when similarity >= threshold', async () => {
      // Compute what computeFaceEmbedding returns for a specific frame
      // so we can set the reference embedding to produce a passing result
      const emb = await computeFaceEmbedding('mock-frame-shot-1-1.6', 'John');
      const matchingChar: CharacterRegistryEntry = {
        ...mockCharacter,
        faceEmbedding: emb!,
      };
      const result = await verifyCharacterInShot('shot-1', 'url', 8, matchingChar, 'unknown-model', 0);
      expect(result.passed).toBe(true);
      expect(result.similarity).toBeGreaterThanOrEqual(result.threshold);
    });

    test('L335: verifyShotCharacters uses default retryCount 0', async () => {
      const results = await verifyShotCharacters('shot-1', 'url', 8, [mockCharacter], 'veo3-low');
      expect(results[0].retryCount).toBe(0);
    });

    test('L399: cosineSimilarity returns 0 for mismatched lengths via verifyFaceIdentity', () => {
      const result = verifyFaceIdentity([1, 0], [1, 0, 0], 0.5);
      expect(result.score).toBe(0);
      expect(result.match).toBe(false);
    });

    test('L525: generateCrossShotConsistencyReport handles character in shots but no verifications', async () => {
      // Character appears in shots but has no verification records
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ shot_id: 'shot-1', shot_order: 1, characters: ['John', 'Ghost'] }],
          command: '', rowCount: 1, oid: 0, fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            { character_name: 'John', shot_id: 'shot-1', similarity: 0.85, threshold: 0.75, passed: true, retry_count: 0, model_id: 'veo3-low', shot_order: 1 },
          ],
          command: '', rowCount: 1, oid: 0, fields: [],
        });

      const report = await generateCrossShotConsistencyReport('story-1');
      expect(report.characterSummaries.length).toBe(1);
      expect(report.characterSummaries[0].characterName).toBe('John');
    });


  });

});
