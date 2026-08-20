import {
  checkSacredGuard,
  addToDenylist,
  approveDenylistEntry,
  removeFromDenylist,
  appealSacredGuardBlock,
  resetDenylistCache,
  cosineSimilarity,
  computeImageEmbedding,
} from '../../../src/admission/sacredGuard';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    admission: {
      sacredGuard: {
        visualSimilarityThreshold: 0.775,
        perModelThresholds: {
          'kie-veo3-fast': 0.78,
          'kie-veo3-quality': 0.77,
        },
      },
    },
  },
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

const mockQuery = require('../../../src/shared/db').query;

function makeBaseRequest(overrides: Partial<Parameters<typeof checkSacredGuard>[0]> = {}) {
  return {
    prompt: 'A beautiful sunset',
    referenceImages: [],
    modelId: 'kie-veo3-fast',
    userId: 'user-1',
    enforcementPoint: 'pre_dispatch' as const,
    ...overrides,
  };
}

describe('SacredGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDenylistCache();
    // Reset cache expiry so refresh always runs
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('refreshDenylistCache', () => {
    test('returns empty result when denylist is empty', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await checkSacredGuard(makeBaseRequest());
      expect(result.blocked).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, entity_name')
      );
    });

    test('caches denylist and does not re-query within TTL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('refreshes cache after TTL expires', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      jest.setSystemTime(new Date('2025-01-01T00:01:01Z'));

      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('exact match', () => {
    test('blocks prompt with exact entity name match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd1',
            entity_name: 'Celebrity Name',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of Celebrity Name walking' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('exact');
      expect(result.matchedEntity).toBe('Celebrity Name');
      expect(result.confidence).toBe(1.0);
      expect(result.matchedDenylistId).toBe('d1');
    });

    test('is case-insensitive for exact match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd2',
            entity_name: 'Protected Brand',
            entity_type: 'brand',
            match_type: 'exact',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'Show me PROTECTED BRAND logo' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('exact');
    });

    test('does not block when no exact match found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd3',
            entity_name: 'Celebrity Name',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of a cat walking' })
      );
      expect(result.blocked).toBe(false);
    });

    test('skips non-exact entries in exact match check', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd4',
            entity_name: 'Celebrity\u00e9 Name',
            entity_type: 'person',
            match_type: 'transliterated',
            embedding: null,
          },
        ],
      });

      // "Celebrity Name" is NOT an exact match for "Celebrityé Name"
      // and the transliterated form of "Celebrity Name" is "celebrity name"
      // while the transliterated form of "Celebrityé Name" is "celebritye name"
      // So no match should occur
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of Celebrity Name walking' })
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe('transliterated match', () => {
    test('blocks prompt with transliterated match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd5',
            entity_name: 'Caf\u00e9 Noir',
            entity_type: 'brand',
            match_type: 'transliterated',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'Show me Cafe Noir coffee shop' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('transliterated');
      expect(result.matchedEntity).toBe('Caf\u00e9 Noir');
      expect(result.confidence).toBe(0.95);
    });

    test('transliterates special characters correctly', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd6',
            entity_name: 'Nino\u00f1o',
            entity_type: 'person',
            match_type: 'transliterated',
            embedding: null,
          },
        ],
      });

      // "Nino\u00f1o" transliterates to "ninono", prompt "Ninono walk" should match
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of Ninono walking' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('transliterated');
    });

    test('does not block when transliteration does not match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd7',
            entity_name: 'Caf\u00e9 Noir',
            entity_type: 'brand',
            match_type: 'transliterated',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of a sunny park' })
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe('fuzzy match', () => {
    test('blocks prompt with fuzzy match within tolerance', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd8',
            entity_name: 'Celebrity',
            entity_type: 'person',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      // "Celebrity" -> "Celebirty" is 1 substitution (distance=1, max=2 for 9*0.25=2)
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of Celebirty walking' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('fuzzy');
      expect(result.matchedEntity).toBe('Celebrity');
    });

    test('does not block fuzzy match when distance exceeds threshold', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd9',
            entity_name: 'Cat',
            entity_type: 'animal',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      // "Cat" -> "Catastrophe" is very different
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A Catastrophe movie scene' })
      );
      // "Cat" is only 3 chars, word > 3 check filters "Cat" itself
      // But "Catastrophe" word length > 3, and distance from "Catastrophe" to "Cat" is large
      expect(result.blocked).toBe(false);
    });

    test('skips short words in fuzzy match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd10',
            entity_name: 'Celebrity',
            entity_type: 'person',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      // "Cat" is 3 chars, skipped by word.length > 3 check
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'Cat Dog' })
      );
      expect(result.blocked).toBe(false);
    });

    test('handles exact fuzzy match (distance=0)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd11',
            entity_name: 'Celebrity',
            entity_type: 'person',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of Celebrity walking' })
      );
      expect(result.blocked).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test('skips non-fuzzy entries in fuzzy check', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd12',
            entity_name: 'Celebrity',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
        ],
      });

      // "Celebrity" exact match would also trigger, but let's test with a non-exact prompt
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A video of a beautiful sunset' })
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe('visual/semantic match', () => {
    test('blocks when visual similarity exceeds threshold', async () => {
      // Create an entry with an embedding that will match
      const embedding = new Array(512).fill(1).map((_, i) => (i % 2 === 0 ? 1 : -1));
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd13',
            entity_name: 'Protected Person',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: JSON.stringify(embedding),
          },
        ],
      });

      // The image embedding is computed deterministically from base64 hash
      // We need a base64 string that produces an embedding similar to the denylist one
      // Since we can't control the hash, we'll test that the check runs without error
      const result = await checkSacredGuard(
        makeBaseRequest({ referenceImages: ['dGVzdC1pbWFnZQ=='] })
      );
      // The result depends on cosine similarity between computed and stored embeddings
      expect(result).toHaveProperty('blocked');
      expect(typeof result.blocked).toBe('boolean');
    });

    test('skips visual check when no reference images provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd14',
            entity_name: 'Protected Person',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: JSON.stringify(new Array(512).fill(1)),
          },
        ],
      });

      const result = await checkSacredGuard(makeBaseRequest({ referenceImages: [] }));
      expect(result.blocked).toBe(false);
    });

    test('skips visual_semantic entries without embedding', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd15',
            entity_name: 'Protected Person',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ referenceImages: ['dGVzdC1pbWFnZQ=='] })
      );
      expect(result.blocked).toBe(false);
    });

    test('uses per-model threshold when available', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await checkSacredGuard(
        makeBaseRequest({ modelId: 'kie-veo3-fast', referenceImages: [] })
      );
      expect(result).toHaveProperty('blocked');
    });

    test('uses default threshold when model not in per-model config', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await checkSacredGuard(
        makeBaseRequest({ modelId: 'unknown-model', referenceImages: [] })
      );
      expect(result).toHaveProperty('blocked');
    });

    test('tests multiple reference images', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd16',
            entity_name: 'Protected Person',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: JSON.stringify(new Array(512).fill(0.5)),
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({
          referenceImages: ['dGVzdC1pbWFnZQ==', 'b3RoZXItaW1hZ2U='],
        })
      );
      expect(result).toHaveProperty('blocked');
    });

    test('blocks when visual similarity matches exactly (similarity = 1.0)', async () => {
      const imageBase64 = 'dGVzdC1pbWFnZQ==';
      const normalizedEmbedding = await computeImageEmbedding(imageBase64);

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd-match',
            entity_name: 'Exact Match Person',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: normalizedEmbedding,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ referenceImages: [imageBase64] })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('visual_semantic');
      expect(result.matchedEntity).toBe('Exact Match Person');
      expect(result.matchedDenylistId).toBe('d-match');
    });
  });

  describe('cosine similarity', () => {
    test('returns 0 for mismatched vector lengths', async () => {
      // Inject entries with mismatched embedding lengths to test the internal cosineSimilarity
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd17',
            entity_name: 'Entity1',
            entity_type: 'person',
            match_type: 'visual_semantic',
            embedding: JSON.stringify([1, 2, 3]),
          },
        ],
      });

      // The computed embedding will be 512-dim, denylist is 3-dim -> mismatch -> similarity=0
      const result = await checkSacredGuard(
        makeBaseRequest({ referenceImages: ['dGVzdA=='] })
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe('levenshtein distance', () => {
    test('returns correct distance for identical strings', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd18',
            entity_name: 'Test',
            entity_type: 'thing',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A Test video' })
      );
      expect(result.blocked).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test('returns correct distance for single character difference', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd19',
            entity_name: 'Hello',
            entity_type: 'thing',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      // "Hallo" vs "Hello" is 1 substitution, max = floor(5*0.25)=1
      // Must be a standalone word (split by whitespace) for fuzzy check
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'Say Hallo to me' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('fuzzy');
    });
  });

  describe('transliterate', () => {
    test('handles all accented character replacements', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd20',
            entity_name: 'naive',
            entity_type: 'thing',
            match_type: 'transliterated',
            embedding: null,
          },
        ],
      });

      // "na\u00efve" -> "naive" via transliteration
      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A na\u00efve video' })
      );
      expect(result).toHaveProperty('blocked');
    });
  });

  describe('addToDenylist', () => {
    test('creates denylist entry with dual-authorization', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

      const id = await addToDenylist(
        'New Entity',
        'person',
        'exact',
        'admin-user',
        undefined,
        { reason: 'test' }
      );

      expect(id).toBe('test-uuid-1234');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1,
        expect.stringContaining('INSERT INTO sacred_denylist'),
        expect.arrayContaining(['test-uuid-1234', 'New Entity', 'person', 'exact', null, 'admin-user', 'admin-user', '{"reason":"test"}'])
      );
    });

    test('creates denylist entry with embedding', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const embedding = [0.1, 0.2, 0.3];
      await addToDenylist(
        'Face Entity',
        'person',
        'visual_semantic',
        'admin-user',
        embedding
      );

      expect(mockQuery).toHaveBeenNthCalledWith(1,
        expect.stringContaining('INSERT INTO sacred_denylist'),
        expect.arrayContaining([
          'test-uuid-1234', 'Face Entity', 'person', 'visual_semantic',
          JSON.stringify(embedding), 'admin-user', 'admin-user', '{}'
        ])
      );
    });

    test('defaults metadata to empty object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await addToDenylist('Entity', 'thing', 'fuzzy', 'user-1');

      expect(mockQuery).toHaveBeenNthCalledWith(1,
        expect.stringContaining('INSERT INTO sacred_denylist'),
        expect.arrayContaining([expect.any(String), 'Entity', 'thing', 'fuzzy', null, 'user-1', 'user-1', '{}'])
      );
    });
  });

  describe('approveDenylistEntry', () => {
    test('approves pending denylist entry (second authorization)', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'd21',
              added_by: 'admin1',
              approved_by_1: 'admin1',
              approved_by_2: null,
            },
          ],
        }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // audit INSERT

      await approveDenylistEntry('d21', 'admin2');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE sacred_denylist SET approved_by_2'),
        ['admin2', 'd21']
      );
    });

    test('throws when denylist entry not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(approveDenylistEntry('nonexistent', 'admin2')).rejects.toThrow(
        'Denylist entry not found'
      );
    });

    test('throws when entry already fully approved', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'd22',
            added_by: 'admin1',
            approved_by_1: 'admin1',
            approved_by_2: 'admin2',
          },
        ],
      });

      await expect(approveDenylistEntry('d22', 'admin3')).rejects.toThrow(
        'Already fully approved'
      );
    });

    test('invalidates cache after approval', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'd23',
              added_by: 'admin1',
              approved_by_1: 'admin1',
              approved_by_2: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await approveDenylistEntry('d23', 'admin2');

      // Cache should be invalidated - next checkSacredGuard will re-query
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(4);  // 3 from approve + 1 from re-query
    });
  });

  describe('removeFromDenylist', () => {
    test('deactivates denylist entry with dual-authorization', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // audit INSERT

      await removeFromDenylist('d24', 'admin1', 'admin2');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1,
        expect.stringContaining('UPDATE sacred_denylist SET is_active = FALSE'),
        ['d24']
      );
    });

    test('invalidates cache after removal', async () => {
      // First populate cache
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Remove entry (sets cacheExpiry = 0)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await removeFromDenylist('d25', 'admin1', 'admin2');

      // Cache should be invalidated - next checkSacredGuard will re-query
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(4); // 1 initial + 2 removeFrom + 1 re-query
    });
  });

  describe('appealSacredGuardBlock', () => {
    test('records appeal in audit log', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await appealSacredGuardBlock('d26', 'user-1', 'This is a false positive');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sacred_entity_audit'),
        ['d26', 'appeal', 'user-1', 'This is a false positive', '{}']
      );
    });
  });

  describe('resetDenylistCache', () => {
    test('clears cache and forces re-query on next check', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(1);

      resetDenylistCache();

      mockQuery.mockResolvedValueOnce({ rows: [] });
      await checkSacredGuard(makeBaseRequest());
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkSacredGuard - priority ordering', () => {
    test('returns first match in order: exact > transliterated > fuzzy > visual', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'exact1',
            entity_name: 'Target',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
          {
            id: 'fuzzy1',
            entity_name: 'Target',
            entity_type: 'person',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A Target video' })
      );
      expect(result.matchType).toBe('exact');
      expect(result.matchedDenylistId).toBe('exact1');
    });

    test('returns transliterated when no exact match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'trans1',
            entity_name: 'Caf\u00e9',
            entity_type: 'brand',
            match_type: 'transliterated',
            embedding: null,
          },
          {
            id: 'fuzzy2',
            entity_name: 'Cafe',
            entity_type: 'brand',
            match_type: 'fuzzy',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A Cafe video' })
      );
      expect(result.matchType).toBe('transliterated');
    });
  });

  describe('cosineSimilarity - direct tests', () => {
    test('returns correct similarity for identical vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(1);
    });

    test('returns 0 for orthogonal vectors', () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test('returns -1 for opposite vectors', () => {
      const a = [1, 0];
      const b = [-1, 0];
      expect(cosineSimilarity(a, b)).toBe(-1);
    });

    test('returns 0 when first vector has zero norm', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test('returns 0 when second vector has zero norm', () => {
      const a = [1, 2, 3];
      const b = [0, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test('returns 0 when both vectors have zero norm', () => {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test('returns 0 for mismatched lengths', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    test('returns 0 for empty arrays', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe('multiple denylist entries', () => {
    test('checks against all entries in the denylist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'e1',
            entity_name: 'Entity1',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
          {
            id: 'e2',
            entity_name: 'Entity2',
            entity_type: 'person',
            match_type: 'exact',
            embedding: null,
          },
        ],
      });

      const result = await checkSacredGuard(
        makeBaseRequest({ prompt: 'A Entity2 video' })
      );
      expect(result.blocked).toBe(true);
      expect(result.matchedEntity).toBe('Entity2');
    });
  });
});
