/**
 * Unit tests for Story Ingestion Service (Phase 1)
 */

import { createStory, getStory, presentShotPlan, approveShotPlan, reviseShotPlan, decomposeStoryToShots } from '../../../src/ingestion/storyService';
import { pool } from '../../../src/shared/db';
import type { AspectRatio, ShotPlanRevision } from '../../../src/shared/types';

// Mock the database
jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  getPool: jest.fn(),
}));

jest.mock('../../../src/shared/events', () => ({
  storyStateMachine: {
    setCurrentState: jest.fn(),
    getCurrentState: jest.fn(),
  },
  emitStoryStateChange: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    modelRegistry: { models: [] },
  },
}));

const mockQuery = require('../../../src/shared/db').query;
const mockTransaction = require('../../../src/shared/db').transaction;
const mockEmitStoryStateChange = require('../../../src/shared/events').emitStoryStateChange;

describe('Story Ingestion Service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockEmitStoryStateChange.mockResolvedValue(undefined);
  });

  describe('decomposeStoryToShots', () => {
    test('decomposes narrative into shots', async () => {
      const brief = {
        narrative: 'A person walks into a room. They sit down and read a book.',
        targetDurationSeconds: 20,
        characterReferences: [{ name: 'Alice', imageBase64: 'base64image' }],
      };

      const shots = await decomposeStoryToShots(brief);

      expect(shots.length).toBeGreaterThan(0);
      expect(shots[0]).toHaveProperty('visualDescription');
      expect(shots[0]).toHaveProperty('durationSeconds');
      expect(shots[0]).toHaveProperty('characters');
    });

    test('handles empty narrative', async () => {
      const brief = {
        narrative: '',
        targetDurationSeconds: 10,
      };

      const shots = await decomposeStoryToShots(brief);
      expect(shots.length).toBeGreaterThan(0); // Still creates at least one shot
    });
  });

  describe('createStory', () => {
    test('creates story with valid brief', async () => {
      mockTransaction.mockImplementation(async (callback: (client: any) => Promise<any>) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ }),
        };
        return callback(mockClient);
      });

      const request = {
        brief: {
          narrative: 'Test story',
          targetDurationSeconds: 30,
          aspectRatio: '16:9' as AspectRatio,
        },
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = await createStory(request);

      expect(result).toHaveProperty('storyId');
      expect(result).toHaveProperty('shotPlan');
      expect(result.shotPlan.length).toBeGreaterThan(0);
      expect(result.status).toBe('planning');
    });

    test('rejects empty narrative', async () => {
      const request = {
        brief: {
          narrative: '',
          targetDurationSeconds: 30,
        },
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(createStory(request)).rejects.toThrow('Story narrative required');
    });

    test('rejects invalid aspect ratio', async () => {
      const request = {
        brief: {
          narrative: 'Test story',
          targetDurationSeconds: 30,
          aspectRatio: '21:9' as AspectRatio,
        },
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(createStory(request)).rejects.toThrow('Invalid aspect ratio');
    });
  });

  describe('reviseShotPlan', () => {
    test('adds a new shot', async () => {
      const mockStory = {
        id: 'story-1',
        status: 'planning',
        shots: [
          { id: 'shot-1', order: 0 },
        ],
      };

      // First getStory call (before transaction): story query + shots query
      mockQuery
        .mockResolvedValueOnce({ rows: [mockStory] })
        .mockResolvedValueOnce({ rows: [] });

      mockTransaction.mockImplementation(async (callback: (client: any) => Promise<any>) => {
        const mockClient = { query: jest.fn().mockResolvedValue({ }) };
        return callback(mockClient);
      });

      // Second getStory call (after transaction): story query + shots query with new shot
      const updatedStoryRow = { ...mockStory, shots: [mockStory.shots[0], { id: 'new-shot' }] };
      mockQuery
        .mockResolvedValueOnce({ rows: [updatedStoryRow] }) // story query
        .mockResolvedValueOnce({
          rows: [
            { id: 'shot-1', order_index: 0, story_id: 'story-1', visual_description: '', duration_seconds: 5, camera_motion: 'static', characters: [], key_objects: [], key_actions: [], audio_cues: null, style_references: null, negative_prompts: null, transition: null, status: 'planned', created_at: new Date(), updated_at: new Date() },
            { id: 'new-shot', order_index: 1, story_id: 'story-1', visual_description: 'New shot', duration_seconds: 5, camera_motion: 'static', characters: [], key_objects: [], key_actions: [], audio_cues: null, style_references: null, negative_prompts: null, transition: null, status: 'planned', created_at: new Date(), updated_at: new Date() }
          ]
        }); // shots query

      const revisions: ShotPlanRevision[] = [{
        action: 'add',
        shotData: {
          visualDescription: 'New shot',
          durationSeconds: 5,
          cameraMotion: 'static',
        },
      }];

      const result = await reviseShotPlan('story-1', revisions);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test('rejects revision in wrong status', async () => {
      const mockStory = { id: 'story-1', status: 'generating', shots: [] };
      mockQuery
        .mockResolvedValueOnce({ rows: [mockStory] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(reviseShotPlan('story-1', [{ action: 'add', shotData: {} }]))
        .rejects.toThrow('Cannot revise plan in status: generating');
    });
  });

  describe('presentShotPlan', () => {
    test('presents plan and updates status', async () => {
      const mockStory = { id: 'story-1', status: 'planning', shots: [{ id: 'shot-1' }] };
      mockQuery
        .mockResolvedValueOnce({ rows: [mockStory] }) // getStory - story query
        .mockResolvedValueOnce({ rows: [] }); // getStory - shots query
      mockQuery.mockResolvedValueOnce({ rows: [] }); // update
      mockQuery.mockResolvedValueOnce({ rows: [] }); // event

      const result = await presentShotPlan('story-1');
      expect(result.status).toBe('awaiting_approval');
    });

    test('rejects presentation in wrong status', async () => {
      const mockStory = { id: 'story-1', status: 'generating', shots: [] };
      mockQuery
        .mockResolvedValueOnce({ rows: [mockStory] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(presentShotPlan('story-1')).rejects.toThrow('Cannot present plan in status: generating');
    });
  });
});