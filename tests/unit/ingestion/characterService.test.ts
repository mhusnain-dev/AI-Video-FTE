/**
 * Unit tests for Character Reference Upload Service
 * Covers: detectFaceAndEmbed, uploadCharacterReference, getCharacterReferences,
 *         getCharacterByName, validateCharacterReferences
 */

import { jest } from '@jest/globals';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../../../src/shared/vault', () => ({
  encryptEmbeddingForStorage: jest.fn(),
}));

jest.mock('../../../src/admission/sacredGuard', () => ({
  checkSacredGuard: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  emitCharacterStateChange: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: { postgres: {}, vault: {} },
}));

jest.mock('../../../src/shared/metrics', () => ({
  charactersRegisteredTotal: { inc: jest.fn() },
  characterSacredGuardBlocksTotal: { inc: jest.fn() },
}));

const mockUuidV4 = jest.fn(() => 'test-uuid-1234');
jest.mock('uuid', () => ({
  v4: mockUuidV4,
}));

const mockQuery = require('../../../src/shared/db').query as jest.MockedFunction<any>;
const mockTransaction = require('../../../src/shared/db').transaction as jest.MockedFunction<any>;
const mockEncryptEmbedding = require('../../../src/shared/vault').encryptEmbeddingForStorage as jest.MockedFunction<any>;
const mockCheckSacredGuard = require('../../../src/admission/sacredGuard').checkSacredGuard as jest.MockedFunction<any>;
const mockEmitCharacterStateChange = require('../../../src/shared/events').emitCharacterStateChange as jest.MockedFunction<any>;
const mockCharactersRegisteredTotal = require('../../../src/shared/metrics').charactersRegisteredTotal;
const mockCharacterSacredGuardBlocksTotal = require('../../../src/shared/metrics').characterSacredGuardBlocksTotal;

import {
  detectFaceAndEmbed,
  uploadCharacterReference,
  getCharacterReferences,
  getCharacterByName,
  validateCharacterReferences,
} from '../../../src/ingestion/characterService';

describe('characterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockUuidV4.mockReturnValue('test-uuid-1234');
    mockEmitCharacterStateChange.mockResolvedValue(undefined);
    mockEncryptEmbedding.mockResolvedValue('encrypted-face-data');
    mockCheckSacredGuard.mockResolvedValue({ blocked: false });
  });

  // ==========================================
  // detectFaceAndEmbed
  // ==========================================
  describe('detectFaceAndEmbed', () => {
    test('returns no face for empty string', async () => {
      const result = await detectFaceAndEmbed('');
      expect(result).toEqual({ hasFace: false, confidence: 0 });
    });

    test('returns no face for short base64 string', async () => {
      const result = await detectFaceAndEmbed('abc');
      expect(result).toEqual({ hasFace: false, confidence: 0 });
    });

    test('returns no face for null/undefined input', async () => {
      const result = await detectFaceAndEmbed(undefined as unknown as string);
      expect(result).toEqual({ hasFace: false, confidence: 0 });
    });

    test('returns normalized embedding for valid base64 image', async () => {
      const validBase64 = 'a'.repeat(200);
      const result = await detectFaceAndEmbed(validBase64);

      expect(result.hasFace).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.embedding).toBeDefined();
      expect(result.embedding!.length).toBe(512);
      expect(result.boundingBox).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.8 });

      // Verify normalization: magnitude should be ~1
      const magnitude = Math.sqrt(result.embedding!.reduce((sum: number, v: number) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    test('returns different embeddings on successive calls', async () => {
      const validBase64 = 'b'.repeat(200);
      const r1 = await detectFaceAndEmbed(validBase64);
      const r2 = await detectFaceAndEmbed(validBase64);
      // With random embeddings, they should differ (extremely unlikely to be equal)
      expect(r1.embedding).not.toEqual(r2.embedding);
    });
  });

  // ==========================================
  // uploadCharacterReference
  // ==========================================
  describe('uploadCharacterReference', () => {
    const baseRequest = {
      storyId: 'story-1',
      userId: 'user-1',
      character: {
        name: 'Alice',
        imageBase64: 'a'.repeat(200),
      },
    };

    const mockStoryRow = { id: 'story-1', user_id: 'user-1' };

    function setupStoryExists() {
      mockQuery.mockResolvedValueOnce({ rows: [mockStoryRow] });
    }

    function setupSacredGuardPass() {
      mockCheckSacredGuard.mockResolvedValueOnce({ blocked: false });
    }

    function setupNoDuplicate() {
      mockQuery.mockResolvedValueOnce({ rows: [] });
    }

    function setupTransaction() {
      mockTransaction.mockImplementation(async (callback: (client: any) => Promise<any>) => {
        const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
        return callback(mockClient);
      });
    }

    test('throws when story not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(uploadCharacterReference(baseRequest)).rejects.toThrow('Story not found');
    });

    test('throws when user is unauthorized', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'story-1', user_id: 'other-user' }] });

      await expect(uploadCharacterReference(baseRequest)).rejects.toThrow(
        'Unauthorized: story belongs to another user'
      );
    });

    test('throws when no face detected in image', async () => {
      setupStoryExists();

      await expect(
        uploadCharacterReference({ ...baseRequest, character: { name: 'Alice', imageBase64: 'short' } })
      ).rejects.toThrow('No face detected in reference image');
    });

    test('throws when Sacred Guard blocks the character', async () => {
      setupStoryExists();
      mockCheckSacredGuard.mockResolvedValueOnce({
        blocked: true,
        matchType: 'celebrity',
        reason: 'matches celebrity face',
        matchedDenylistId: 'deny-1',
      });

      await expect(uploadCharacterReference(baseRequest)).rejects.toThrow(
        'Character reference blocked by Sacred Guard: matches celebrity face'
      );
      expect(mockCharacterSacredGuardBlocksTotal.inc).toHaveBeenCalledWith({ match_type: 'celebrity' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sacred_entity_audit'),
        expect.arrayContaining(['deny-1', 'registry_block', 'user-1'])
      );
    });

    test('records audit with null denylist_id when matchType unknown', async () => {
      setupStoryExists();
      mockCheckSacredGuard.mockResolvedValueOnce({
        blocked: true,
        reason: 'some block reason',
      });

      await expect(uploadCharacterReference(baseRequest)).rejects.toThrow(
        'Character reference blocked by Sacred Guard: some block reason'
      );
      expect(mockCharacterSacredGuardBlocksTotal.inc).toHaveBeenCalledWith({ match_type: 'unknown' });
    });

    test('throws when duplicate character image exists', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-char' }] });

      await expect(uploadCharacterReference(baseRequest)).rejects.toThrow(
        'Character with this reference image already exists in story'
      );
    });

    test('successfully registers character without voice', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      // Mock encryptEmbeddingForStorage to call the getDek and storeDek callbacks
      mockEncryptEmbedding.mockImplementation(
        async (embedding: any, uid: any, getDek: any, storeDek: any) => {
          await getDek(uid);
          await storeDek(uid, 'dek-base64', 'encrypted-dek');
          return 'encrypted-face-data';
        }
      );

      const result = await uploadCharacterReference(baseRequest);

      expect(result.characterId).toBe('test-uuid-1234');
      expect(result.name).toBe('Alice');
      expect(result.faceEmbeddingStored).toBe(true);
      expect(result.voiceEmbeddingStored).toBe(false);
      expect(mockEmitCharacterStateChange).toHaveBeenCalledWith(
        'test-uuid-1234',
        'none',
        'registered',
        'character_registered',
        { storyId: 'story-1', characterName: 'Alice' },
        'user-1',
        { traceId: 'story-1' }
      );
      expect(mockCharactersRegisteredTotal.inc).toHaveBeenCalledWith({
        story_id: 'story-1',
        has_voice: 'false',
      });
    });

    test('registers character with voice reference', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      // Mock to call both getDek and storeDek callbacks
      mockEncryptEmbedding.mockImplementation(
        async (embedding: any, uid: any, getDek: any, storeDek: any) => {
          await getDek(uid);
          await storeDek(uid, 'dek-base64', 'encrypted-dek');
          return 'encrypted-data';
        }
      );

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-data-12345',
        },
      };

      const result = await uploadCharacterReference(request);

      expect(result.faceEmbeddingStored).toBe(true);
      expect(result.voiceEmbeddingStored).toBe(true);
      expect(mockEncryptEmbedding).toHaveBeenCalledTimes(2);
      expect(mockCharactersRegisteredTotal.inc).toHaveBeenCalledWith({
        story_id: 'story-1',
        has_voice: 'true',
      });
    });

    test('voice encryption branch: encryptEmbeddingForStorage called for both face and voice', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      mockEncryptEmbedding
        .mockResolvedValueOnce('encrypted-face')
        .mockResolvedValueOnce('encrypted-voice');

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-sample-abc',
        },
      };

      const result = await uploadCharacterReference(request);

      expect(mockEncryptEmbedding).toHaveBeenCalledTimes(2);
      expect(result.voiceEmbeddingStored).toBe(true);
      expect(mockCharactersRegisteredTotal.inc).toHaveBeenCalledWith({
        story_id: 'story-1',
        has_voice: 'true',
      });
    });

    test('voice encryption: getDek and storeDek callbacks are invoked', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      const mockGetDek = jest.fn<any>().mockResolvedValue(null);
      const mockStoreDek = jest.fn<any>().mockResolvedValue(undefined);

      mockEncryptEmbedding.mockImplementation(
        async (embedding: any, uid: any, getDek: any, storeDek: any) => {
          await getDek(uid);
          await storeDek(uid, 'new-dek', 'encrypted-new-dek');
          return 'encrypted-result';
        }
      );

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-sample',
        },
      };

      const result = await uploadCharacterReference(request);

      expect(result.faceEmbeddingStored).toBe(true);
      expect(result.voiceEmbeddingStored).toBe(true);
      expect(mockEncryptEmbedding).toHaveBeenCalledTimes(2);
    });

    test('voice encryption: voiceEncrypted is truthy and voice pgvector stored', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      mockEncryptEmbedding
        .mockResolvedValueOnce('encrypted-face')
        .mockResolvedValueOnce('encrypted-voice');

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-data-for-pgvector',
        },
      };

      await uploadCharacterReference(request);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      // voice_embedding_vector should be pgvector format
      expect(params[5]).toMatch(/^\[.*\]$/);
    });

    test('voice encryption: metadata voiceEmbeddingEncrypted flag is true', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      mockEncryptEmbedding
        .mockResolvedValueOnce('encrypted-face')
        .mockResolvedValueOnce('encrypted-voice');

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-for-metadata',
        },
      };

      await uploadCharacterReference(request);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const metadata = JSON.parse(((mockClient.query.mock.calls as any[])[0][1] as any[])[9]);
      expect(metadata.voiceEmbeddingEncrypted).toBe(true);
      expect(metadata.faceEmbeddingEncrypted).toBe(true);
    });

    test('voice callback falsy path: getDek returns null when DEK not yet stored', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      let callIdx = 0;
      mockEncryptEmbedding.mockImplementation(
        async (embedding: any, uid: any, getDek: any, storeDek: any) => {
          callIdx++;
          if (callIdx === 1) {
            // Face call: do NOT store DEK, so voice callback sees empty userDeks
            return 'encrypted-face';
          } else {
            // Voice call: getDek should return null (falsy path of || on line 175)
            const dek = await getDek(uid);
            expect(dek).toBeNull();
            await storeDek(uid, 'voice-dek', 'encrypted-voice-dek');
            return 'encrypted-voice';
          }
        }
      );

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-for-falsy-path',
        },
      };

      const result = await uploadCharacterReference(request);
      expect(result.faceEmbeddingStored).toBe(true);
      expect(result.voiceEmbeddingStored).toBe(true);
    });

    test('stores referenceImageUrl when provided', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      const request = {
        ...baseRequest,
        referenceImageUrl: 'https://example.com/image.png',
      };

      await uploadCharacterReference(request);

      expect(mockTransaction).toHaveBeenCalled();
      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      expect(params[8]).toBe('https://example.com/image.png');
    });

    test('stores null referenceImageUrl when not provided', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      expect(params[8]).toBeNull();
    });

    test('calls Sacred Guard with correct enforcement point', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      expect(mockCheckSacredGuard).toHaveBeenCalledWith({
        prompt: '',
        referenceImages: [baseRequest.character.imageBase64],
        modelId: 'registry-check',
        userId: 'user-1',
        storyId: 'story-1',
        enforcementPoint: 'registry',
      });
    });

    test('stores pgvector formatted embeddings', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      // face_embedding_vector should be pgvector format: [v1,v2,...]
      expect(params[4]).toMatch(/^\[.*\]$/);
      // voice_embedding_vector should be null (no voice)
      expect(params[5]).toBeNull();
    });

    test('stores pgvector formatted voice embedding when provided', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();
      mockEncryptEmbedding.mockResolvedValueOnce('encrypted-face-data');
      mockEncryptEmbedding.mockResolvedValueOnce('encrypted-voice-data');

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-data-12345',
        },
      };

      await uploadCharacterReference(request);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      expect(params[5]).toMatch(/^\[.*\]$/);
    });

    test('includes metadata with face confidence and bounding box', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const insertCall = mockClient.query.mock.calls[0] as any[];
      const params = insertCall[1] as any[];
      const metadata = JSON.parse(params[9]);
      expect(metadata.faceEmbeddingEncrypted).toBe(true);
      expect(metadata.voiceEmbeddingEncrypted).toBe(false);
      expect(metadata.faceConfidence).toBe(0.95);
      expect(metadata.boundingBox).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.8 });
    });

    test('includes metadata with voice encryption flag true when voice present', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();
      mockEncryptEmbedding.mockResolvedValueOnce('encrypted-face-data');
      mockEncryptEmbedding.mockResolvedValueOnce('encrypted-voice-data');

      const request = {
        ...baseRequest,
        character: {
          ...baseRequest.character,
          voiceReferenceBase64: 'voice-data',
        },
      };

      await uploadCharacterReference(request);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const metadata = JSON.parse(((mockClient.query.mock.calls as any[])[0][1] as any[])[9]);
      expect(metadata.voiceEmbeddingEncrypted).toBe(true);
    });

    test('inserts character and story_event in transaction', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      const calls = mockClient.query.mock.calls as any[];
      // First call: INSERT INTO characters
      expect(calls[0][0]).toContain('INSERT INTO characters');
      // Second call: INSERT INTO story_events
      expect(calls[1][0]).toContain('INSERT INTO story_events');
      const eventParams = calls[1][1] as any[];
      expect(eventParams[0]).toBe('character');
      expect(eventParams[2]).toBe('character_registered');
      expect(eventParams[3]).toBe('none');
      expect(eventParams[4]).toBe('registered');
    });

    test('character image base64 is stored for Face-Lock conditioning', async () => {
      setupStoryExists();
      setupSacredGuardPass();
      setupNoDuplicate();
      setupTransaction();

      await uploadCharacterReference(baseRequest);

      const transactionCallback = mockTransaction.mock.calls[0][0];
      const mockClient = { query: jest.fn<any>().mockResolvedValue({}) };
      await transactionCallback(mockClient);

      const params = (mockClient.query.mock.calls as any[])[0][1] as any[];
      expect(params[7]).toBe(baseRequest.character.imageBase64);
    });
  });

  // ==========================================
  // getCharacterReferences
  // ==========================================
  describe('getCharacterReferences', () => {
    test('returns mapped character entries', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'c1',
            user_id: 'u1',
            story_id: 's1',
            name: 'Alice',
            face_embedding_vector: [0.1, 0.2],
            voice_embedding_vector: [0.3, 0.4],
            reference_image_hash: 'hash1',
            reference_image_base64: 'img1',
            reference_image_url: 'url1',
            metadata: { foo: 'bar' },
            created_at: new Date('2025-01-01'),
            updated_at: new Date('2025-01-02'),
          },
        ],
      });

      const result = await getCharacterReferences('s1');

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        id: 'c1',
        userId: 'u1',
        storyId: 's1',
        name: 'Alice',
        faceEmbedding: [0.1, 0.2],
        voiceEmbedding: [0.3, 0.4],
        referenceImageHash: 'hash1',
        referenceImageBase64: 'img1',
        referenceImageUrl: 'url1',
        metadata: { foo: 'bar' },
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM characters WHERE story_id'),
        ['s1']
      );
    });

    test('returns empty array when no characters found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getCharacterReferences('s1');
      expect(result).toEqual([]);
    });

    test('returns multiple characters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'c1', user_id: 'u1', story_id: 's1', name: 'Alice', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h1', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
          { id: 'c2', user_id: 'u1', story_id: 's1', name: 'Bob', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h2', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
        ],
      });

      const result = await getCharacterReferences('s1');
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
    });
  });

  // ==========================================
  // getCharacterByName
  // ==========================================
  describe('getCharacterByName', () => {
    test('returns character when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'c1',
            user_id: 'u1',
            story_id: 's1',
            name: 'Alice',
            face_embedding_vector: [0.1],
            voice_embedding_vector: null,
            reference_image_hash: 'h1',
            reference_image_base64: 'img',
            reference_image_url: null,
            metadata: {},
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await getCharacterByName('s1', 'Alice');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Alice');
      expect(result!.id).toBe('c1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM characters WHERE story_id'),
        ['s1', 'Alice']
      );
    });

    test('returns null when character not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getCharacterByName('s1', 'NonExistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================
  // validateCharacterReferences
  // ==========================================
  describe('validateCharacterReferences', () => {
    test('returns valid with no warnings when all characters registered', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'c1', user_id: 'u1', story_id: 's1', name: 'Alice', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h1', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
          { id: 'c2', user_id: 'u1', story_id: 's1', name: 'Bob', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h2', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
        ],
      });

      const result = await validateCharacterReferences('s1', [['Alice', 'Bob']]);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test('warns about missing characters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'c1', user_id: 'u1', story_id: 's1', name: 'Alice', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h1', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
        ],
      });

      const result = await validateCharacterReferences('s1', [['Alice', 'Charlie']]);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual(['Charlie']);
      expect(result.warnings).toEqual([
        'Character "Charlie" appears in shot but not in registry (EC-005)',
      ]);
    });

    test('deduplicates missing characters across shots', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await validateCharacterReferences('s1', [
        ['Alice', 'Bob'],
        ['Alice', 'Charlie'],
      ]);

      expect(result.missingCharacters).toEqual(['Alice', 'Bob', 'Charlie']);
      expect(result.warnings.length).toBe(4);
    });

    test('is case-insensitive for character name matching', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'c1', user_id: 'u1', story_id: 's1', name: 'Alice', face_embedding_vector: [], voice_embedding_vector: null, reference_image_hash: 'h1', reference_image_base64: null, reference_image_url: null, metadata: null, created_at: new Date(), updated_at: new Date() },
        ],
      });

      const result = await validateCharacterReferences('s1', [['alice', 'ALICE']]);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test('handles empty shots array', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await validateCharacterReferences('s1', []);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test('handles shots with empty character lists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await validateCharacterReferences('s1', [[], []]);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test('warns for multiple unregistered characters in different shots', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await validateCharacterReferences('s1', [['Alice'], ['Bob'], ['Charlie']]);

      expect(result.valid).toBe(true);
      expect(result.missingCharacters).toEqual(['Alice', 'Bob', 'Charlie']);
      expect(result.warnings.length).toBe(3);
    });
  });
});
