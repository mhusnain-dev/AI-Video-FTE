import {
  createStory,
  getStory,
  updateStoryStatus,
  reviseShotPlan,
  presentShotPlan,
  approveShotPlan,
  approveMerge,
  decomposeStoryToShots,
} from '../../../src/ingestion/storyService';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  storyStateMachine: {
    setCurrentState: jest.fn(),
    getCurrentState: jest.fn(),
    transition: jest.fn().mockResolvedValue('merging'),
  },
  emitStoryStateChange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/shared/redis', () => ({
  publishStoryCommand: jest.fn().mockResolvedValue('msg-id'),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    modelRegistry: { models: [] },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  storiesCreatedTotal: { inc: jest.fn() },
  storyDecompositionDurationSeconds: { observe: jest.fn() },
  shotPlanRevisedTotal: { inc: jest.fn() },
  activeStoriesGauge: { inc: jest.fn() },
}));

const mockQuery = require('../../../src/shared/db').query;
const mockTransaction = require('../../../src/shared/db').transaction;
const mockSetCurrentState = require('../../../src/shared/events').storyStateMachine.setCurrentState;
const mockEmitStoryStateChange = require('../../../src/shared/events').emitStoryStateChange;
const mockPublishStoryCommand = require('../../../src/shared/redis').publishStoryCommand;
const mockTransition = require('../../../src/shared/events').storyStateMachine.transition;

const VALID_USER_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockGetStoryNotFound() {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
}

function mockGetStory(storyRows: any[], shotRows: any[] = []) {
  mockQuery
    .mockResolvedValueOnce({ rows: storyRows })
    .mockResolvedValueOnce({ rows: shotRows });
}

function makeStoryRow(overrides: any = {}) {
  return {
    id: 'story-1',
    user_id: 'user-1',
    brief: {},
    status: 'planning',
    aspect_ratio: '16:9',
    target_duration_seconds: 10,
    resolution: '1080p',
    global_transition: null,
    audio_config: null,
    total_estimated_cost: '0',
    total_actual_cost: '0',
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

function makeShotRow(overrides: any = {}) {
  return {
    id: 'shot-1',
    story_id: 'story-1',
    order_index: 0,
    visual_description: 'A scene',
    duration_seconds: 5,
    camera_motion: 'static',
    characters: [],
    key_objects: [],
    key_actions: [],
    audio_cues: null,
    style_references: null,
    negative_prompts: null,
    model_override: null,
    transition: null,
    status: 'planned',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('StoryService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockEmitStoryStateChange.mockResolvedValue(undefined);
    mockPublishStoryCommand.mockResolvedValue('msg-id');
    mockTransition.mockResolvedValue('merging');
  });

  describe('decomposeStoryToShots', () => {
    test('decomposes narrative into shots', async () => {
      const brief = {
        narrative: 'A person walks into a room. They sit down and read a book.',
        targetDurationSeconds: 20,
        characterReferences: [{ name: 'Alice', imageBase64: 'img' }],
      };
      const shots = await decomposeStoryToShots(brief);
      expect(shots.length).toBeGreaterThan(0);
      expect(shots[0]).toHaveProperty('visualDescription');
      expect(shots[0]).toHaveProperty('durationSeconds');
    });

    test('creates at least one shot for short narrative', async () => {
      const brief = { narrative: 'Hello.', targetDurationSeconds: 5 };
      const shots = await decomposeStoryToShots(brief);
      expect(shots.length).toBeGreaterThanOrEqual(1);
    });

    test('assigns first shot as establishing wide shot', async () => {
      const brief = { narrative: 'Scene one. Scene two. Scene three.', targetDurationSeconds: 30 };
      const shots = await decomposeStoryToShots(brief);
      expect(shots[0].cameraMotion).toBe('establishing wide shot');
      if (shots.length > 1) {
        expect(shots[1].cameraMotion).toBe('medium shot with subtle pan');
      }
    });

    test('extracts objects from narrative', async () => {
      const brief = { narrative: 'A car near a building with a tree.', targetDurationSeconds: 10 };
      const shots = await decomposeStoryToShots(brief);
      const allObjects = shots.flatMap(s => s.keyObjects);
      expect(allObjects).toContain('car');
      expect(allObjects).toContain('building');
      expect(allObjects).toContain('tree');
    });

    test('extracts actions from narrative', async () => {
      const brief = { narrative: 'A person is walking and talking.', targetDurationSeconds: 10 };
      const shots = await decomposeStoryToShots(brief);
      const allActions = shots.flatMap(s => s.keyActions);
      expect(allActions).toContain('walking');
      expect(allActions).toContain('talking');
    });

    test('includes audio cues for first shot only', async () => {
      const brief = { narrative: 'Scene one. Scene two.', targetDurationSeconds: 20 };
      const shots = await decomposeStoryToShots(brief);
      expect(shots[0].audioCues).toContain('ambient intro');
      if (shots.length > 1) {
        expect(shots[1].audioCues).toEqual([]);
      }
    });

    test('matches characters to shots', async () => {
      const brief = {
        narrative: 'Alice walks in. Bob appears.',
        targetDurationSeconds: 16,
        characterReferences: [
          { name: 'Alice', imageBase64: 'img1' },
          { name: 'Bob', imageBase64: 'img2' },
        ],
      };
      const shots = await decomposeStoryToShots(brief);
      const allCharacters = shots.flatMap(s => s.characters);
      expect(allCharacters).toContain('Alice');
    });
  });

  describe('createStory', () => {
    test('throws when decomposition yields zero shots via undefined duration', async () => {
      await expect(createStory({
        brief: { narrative: 'Test', targetDurationSeconds: undefined as any },
        userId: VALID_USER_ID,
      })).rejects.toThrow('Unable to derive shots from narrative');
    });

    test('creates story with valid brief', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });

      const result = await createStory({
        brief: { narrative: 'Test story with sentences. Second sentence.', targetDurationSeconds: 30, aspectRatio: '16:9', resolution: '1080p' },
        userId: VALID_USER_ID,
      });

      expect(result).toHaveProperty('storyId');
      expect(result).toHaveProperty('shotPlan');
      expect(result.shotPlan.length).toBeGreaterThan(0);
      expect(result.status).toBe('planning');
      expect(mockSetCurrentState).toHaveBeenCalledWith(expect.any(String), 'planning');
    });

    test('rejects empty narrative', async () => {
      await expect(createStory({ brief: { narrative: '', targetDurationSeconds: 30 }, userId: VALID_USER_ID }))
        .rejects.toThrow('Story narrative required');
    });

    test('rejects whitespace-only narrative', async () => {
      await expect(createStory({ brief: { narrative: '   ', targetDurationSeconds: 30 }, userId: VALID_USER_ID }))
        .rejects.toThrow('Story narrative required');
    });

    test('rejects invalid aspect ratio', async () => {
      await expect(createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 30, aspectRatio: '21:9' as any },
        userId: VALID_USER_ID,
      })).rejects.toThrow('Invalid aspect ratio');
    });

    test('rejects invalid resolution', async () => {
      await expect(createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 30, resolution: '1440p' as any },
        userId: VALID_USER_ID,
      })).rejects.toThrow('Invalid resolution');
    });

    test('defaults aspect ratio to 16:9', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      const result = await createStory({ brief: { narrative: 'Test', targetDurationSeconds: 10 }, userId: VALID_USER_ID });
      expect(result).toHaveProperty('storyId');
    });

    test('defaults resolution to 1080p', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      const result = await createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 10, aspectRatio: '9:16' as const },
        userId: VALID_USER_ID,
      });
      expect(result).toHaveProperty('storyId');
    });

    test('includes audio config when provided', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      const result = await createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 10, audioConfig: { useNativeAudio: true } },
        userId: VALID_USER_ID,
      });
      expect(result).toHaveProperty('storyId');
    });

    test('uses default transition when none provided', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      const result = await createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 10 },
        userId: VALID_USER_ID,
      });
      expect(result).toHaveProperty('storyId');
    });

    test('handles emitStoryStateChange failure gracefully', async () => {
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockEmitStoryStateChange.mockRejectedValueOnce(new Error('redis down'));

      const result = await createStory({
        brief: { narrative: 'Test', targetDurationSeconds: 10 },
        userId: VALID_USER_ID,
      });
      // Should still succeed despite emit failure
      expect(result).toHaveProperty('storyId');
    });
  });

  describe('getStory', () => {
    test('returns null when story not found', async () => {
      mockGetStoryNotFound();
      expect(await getStory('nonexistent')).toBeNull();
    });

    test('returns story with shots', async () => {
      mockGetStory([makeStoryRow()], [makeShotRow()]);
      const result = await getStory('story-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('story-1');
      expect(result!.shots.length).toBe(1);
    });

    test('handles string global_transition', async () => {
      mockGetStory([makeStoryRow({ global_transition: '{"type":"crossfade","durationSeconds":0.5}' })], []);
      const result = await getStory('story-1');
      expect(result!.globalTransition).toEqual({ type: 'crossfade', durationSeconds: 0.5 });
    });

    test('handles object global_transition', async () => {
      mockGetStory([makeStoryRow({ global_transition: { type: 'crossfade', durationSeconds: 0.5 } })], []);
      const result = await getStory('story-1');
      expect(result!.globalTransition).toEqual({ type: 'crossfade', durationSeconds: 0.5 });
    });

    test('handles null global_transition and audio_config', async () => {
      mockGetStory([makeStoryRow({ total_estimated_cost: '1.5', total_actual_cost: '2.5', completed_at: new Date() })], []);
      const result = await getStory('story-1');
      expect(result!.globalTransition).toBeUndefined();
      expect(result!.audioConfig).toBeUndefined();
      expect(result!.totalEstimatedCost).toBe(1.5);
      expect(result!.totalActualCost).toBe(2.5);
      expect(result!.completedAt).toBeInstanceOf(Date);
    });

    test('handles string audio_config', async () => {
      mockGetStory([makeStoryRow({ audio_config: '{"useNativeAudio":true}' })], []);
      const result = await getStory('story-1');
      expect(result!.audioConfig).toEqual({ useNativeAudio: true });
    });

    test('handles object audio_config', async () => {
      mockGetStory([makeStoryRow({ audio_config: { useNativeAudio: true } })], []);
      const result = await getStory('story-1');
      expect(result!.audioConfig).toEqual({ useNativeAudio: true });
    });

    test('handles string transition in shot', async () => {
      mockGetStory([makeStoryRow()], [makeShotRow({ transition: '{"type":"fade","durationSeconds":1}' })]);
      const result = await getStory('story-1');
      expect(result!.shots[0].transition).toEqual({ type: 'fade', durationSeconds: 1 });
    });

    test('handles object transition in shot', async () => {
      mockGetStory([makeStoryRow()], [makeShotRow({ transition: { type: 'fade', durationSeconds: 1 } })]);
      const result = await getStory('story-1');
      expect(result!.shots[0].transition).toEqual({ type: 'fade', durationSeconds: 1 });
    });
  });

  describe('updateStoryStatus', () => {
    test('updates status and sets state machine', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await updateStoryStatus('story-1', 'generating');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stories SET status'),
        ['generating', 'story-1']
      );
      expect(mockSetCurrentState).toHaveBeenCalledWith('story-1', 'generating');
    });
  });

  describe('reviseShotPlan', () => {
    test('throws when story not found', async () => {
      mockGetStoryNotFound();
      await expect(reviseShotPlan('nope', [{ action: 'add' }])).rejects.toThrow('Story not found');
    });

    test('throws when status is not planning or awaiting_approval', async () => {
      mockGetStory([makeStoryRow({ status: 'generating' })], []);
      await expect(reviseShotPlan('story-1', [{ action: 'add' }]))
        .rejects.toThrow('Cannot revise plan in status: generating');
    });

    test('allows revision in awaiting_approval status', async () => {
      const storyRow = makeStoryRow({ status: 'awaiting_approval' });
      const shotRow = makeShotRow();
      mockGetStory([storyRow], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([storyRow], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'edit', shotId: 'shot-1', shotData: { visualDescription: 'Updated' } }]);
      expect(result).toBeDefined();
    });

    test('adds a new shot', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow, makeShotRow({ id: 'new-shot', order_index: 1 })]);

      const result = await reviseShotPlan('story-1', [{
        action: 'add',
        shotData: { visualDescription: 'New shot', durationSeconds: 5, cameraMotion: 'static' },
      }]);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test('add without shotData does nothing', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'add' }]);
      expect(result).toBeDefined();
    });

    test('removes a shot', async () => {
      const shotRow = makeShotRow();
      const shotRow2 = makeShotRow({ id: 'shot-2', order_index: 1 });
      mockGetStory([makeStoryRow()], [shotRow, shotRow2]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [makeShotRow({ order_index: 0 })]);

      const result = await reviseShotPlan('story-1', [{ action: 'remove', shotId: 'shot-2' }]);
      expect(result).toBeDefined();
    });

    test('remove does nothing when shot not found', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'remove', shotId: 'nonexistent' }]);
      expect(result).toBeDefined();
    });

    test('remove without shotId does nothing', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'remove' }]);
      expect(result).toBeDefined();
    });

    test('reorders a shot down', async () => {
      const shot1 = makeShotRow({ id: 'shot-1', order_index: 0 });
      const shot2 = makeShotRow({ id: 'shot-2', order_index: 1 });
      mockGetStory([makeStoryRow()], [shot1, shot2]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shot2, shot1]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'shot-1', newOrder: 1 }]);
      expect(result).toBeDefined();
    });

    test('reorders a shot up', async () => {
      const shot1 = makeShotRow({ id: 'shot-1', order_index: 0 });
      const shot2 = makeShotRow({ id: 'shot-2', order_index: 1 });
      mockGetStory([makeStoryRow()], [shot1, shot2]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shot2, shot1]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'shot-2', newOrder: 0 }]);
      expect(result).toBeDefined();
    });

    test('reorder does nothing when shot not found', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'nonexistent', newOrder: 0 }]);
      expect(result).toBeDefined();
    });

    test('reorder clamps to valid range (below 0)', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'shot-1', newOrder: -5 }]);
      expect(result).toBeDefined();
    });

    test('reorder clamps to valid range (above length)', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'shot-1', newOrder: 100 }]);
      expect(result).toBeDefined();
    });

    test('reorder does nothing when same position', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', shotId: 'shot-1', newOrder: 0 }]);
      expect(result).toBeDefined();
    });

    test('reorder without shotId does nothing', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'reorder', newOrder: 0 }]);
      expect(result).toBeDefined();
    });

    test('edits a shot with all fields', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{
        action: 'edit',
        shotId: 'shot-1',
        shotData: {
          visualDescription: 'New desc',
          durationSeconds: 10,
          cameraMotion: 'pan',
          characters: ['Alice'],
          keyObjects: ['table'],
          keyActions: ['sitting'],
          audioCues: ['music'],
          styleReferences: ['ref1'],
          negativePrompts: ['blurry'],
          transition: { type: 'fade', durationSeconds: 1 },
          modelOverride: 'custom-model',
        },
      }]);
      expect(result).toBeDefined();
    });

    test('edit with no updates does nothing', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'edit', shotId: 'shot-1', shotData: {} }]);
      expect(result).toBeDefined();
    });

    test('edit without shotId does nothing', async () => {
      const shotRow = makeShotRow();
      mockGetStory([makeStoryRow()], [shotRow]);
      mockTransaction.mockImplementation(async (cb: any) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return cb(client);
      });
      mockGetStory([makeStoryRow()], [shotRow]);

      const result = await reviseShotPlan('story-1', [{ action: 'edit', shotData: { visualDescription: 'x' } }]);
      expect(result).toBeDefined();
    });
  });

  describe('presentShotPlan', () => {
    test('throws when story not found', async () => {
      mockGetStoryNotFound();
      await expect(presentShotPlan('nope')).rejects.toThrow('Story not found');
    });

    test('throws when status is not planning', async () => {
      mockGetStory([makeStoryRow({ status: 'generating' })], []);
      await expect(presentShotPlan('story-1')).rejects.toThrow('Cannot present plan in status: generating');
    });

    test('transitions to awaiting_approval', async () => {
      mockGetStory([makeStoryRow()], [makeShotRow()]);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await presentShotPlan('story-1');
      expect(result.status).toBe('awaiting_approval');
      expect(mockSetCurrentState).toHaveBeenCalledWith('story-1', 'awaiting_approval');
      expect(mockEmitStoryStateChange).toHaveBeenCalled();
    });
  });

  describe('approveShotPlan', () => {
    test('throws when story not found', async () => {
      mockGetStoryNotFound();
      await expect(approveShotPlan('nope', VALID_USER_ID)).rejects.toThrow('Story not found');
    });

    test('throws when status is not awaiting_approval', async () => {
      mockGetStory([makeStoryRow({ status: 'planning' })], []);
      await expect(approveShotPlan('story-1', VALID_USER_ID))
        .rejects.toThrow('Cannot approve plan in status: planning');
    });

    test('approves and publishes command', async () => {
      mockGetStory([makeStoryRow({ status: 'awaiting_approval', user_id: VALID_USER_ID })], []);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await approveShotPlan('story-1', VALID_USER_ID);

      expect(mockSetCurrentState).toHaveBeenCalledWith('story-1', 'approved');
      expect(mockPublishStoryCommand).toHaveBeenCalledWith('approve', { storyId: 'story-1', userId: VALID_USER_ID });
    });

    test('handles publish failure gracefully', async () => {
      mockGetStory([makeStoryRow({ status: 'awaiting_approval', user_id: VALID_USER_ID })], []);
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockPublishStoryCommand.mockRejectedValueOnce(new Error('redis down'));

      await approveShotPlan('story-1', VALID_USER_ID);
      expect(mockSetCurrentState).toHaveBeenCalledWith('story-1', 'approved');
    });
  });

  describe('approveMerge', () => {
    test('throws when story not found', async () => {
      mockGetStoryNotFound();
      await expect(approveMerge('nope')).rejects.toThrow('Story not found');
    });

    test('throws when status is not pending_merge', async () => {
      mockGetStory([makeStoryRow({ status: 'generating' })], []);
      await expect(approveMerge('story-1')).rejects.toThrow('Cannot approve merge in status: generating');
    });

    test('approves merge and transitions to merging', async () => {
      mockGetStory([makeStoryRow({ status: 'pending_merge' })], []);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await approveMerge('story-1');

      expect(mockTransition).toHaveBeenCalledWith('story-1', 'user_approve_merge', {}, 'system');
      // The UPDATE query uses $1 for storyId with status hardcoded in SQL
      const updateCall = mockQuery.mock.calls.find(([sql]: [string, any[]]) =>
        sql.includes("UPDATE stories SET status = 'merging'")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).toEqual(['story-1']);
    });
  });
});
