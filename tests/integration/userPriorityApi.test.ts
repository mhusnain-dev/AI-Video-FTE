/**
 * Integration tests for Model Priority API endpoints (/api/users/:userId/model-priority)
 * Tests the new compatibility layer at src/router/userPriorityRoutes.ts
 */

import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Mock the database BEFORE importing routes
const mockQuery = jest.fn();
jest.mock('../../src/shared/db', () => ({
  query: mockQuery,
  transaction: jest.fn(),
}));

// Mock config
jest.mock('../../src/shared/config', () => ({
  config: {
    modelRegistry: {
      models: [
        {
          id: 'veo3-low',
          name: 'Veo 3 Low Quality',
          provider: 'google',
          maxResolution: '1080p',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
          supportedRegions: ['us', 'eu', 'asia'],
          costPerSecondUsd: 0,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
          defaultTimeoutSeconds: 120,
        },
        {
          id: 'veo3-high',
          name: 'Veo 3 High Quality',
          provider: 'google',
          maxResolution: '4K',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
          supportedRegions: ['us', 'eu', 'asia'],
          costPerSecondUsd: 0.05,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning', 'native_audio', 'high_fidelity'],
          defaultTimeoutSeconds: 180,
        },
        {
          id: 'runway-gen3',
          name: 'Runway Gen-3 Alpha',
          provider: 'runway',
          maxResolution: '1080p',
          maxDurationSeconds: 10,
          supportedAspectRatios: ['16:9', '9:16'],
          supportedRegions: ['us', 'eu'],
          costPerSecondUsd: 0.08,
          costCurrency: 'USD',
          capabilities: ['text_to_video', 'image_to_video', 'reference_conditioning'],
          defaultTimeoutSeconds: 180,
        },
      ],
      refreshIntervalMs: 300000,
    },
    router: {
      systemDefaultPriority: ['veo3-low', 'veo3-high', 'runway-gen3'],
      eligibilityCheckEnabled: true,
    },
  },
}));

// Mock modelRegistry functions
jest.mock('../../src/router/modelRegistry', () => {
  const actual = jest.requireActual('../../src/router/modelRegistry');
  return {
    ...actual,
    initializeModelRegistryTable: jest.fn().mockResolvedValue(undefined),
    getUserModelPriority: jest.fn(),
    setUserModelPriority: jest.fn(),
    getSystemDefaultPriority: jest.fn().mockResolvedValue({
      priorityList: ['veo3-low', 'veo3-high', 'runway-gen3'],
      updatedAt: new Date(),
    }),
    setSystemDefaultPriority: jest.fn(),
  };
});

import { getUserModelPriority, setUserModelPriority, getSystemDefaultPriority, initializeModelRegistryTable } from '../../src/router/modelRegistry.js';

// Import the routes AFTER mocks are set up
import userPriorityRoutes from '../../src/router/userPriorityRoutes.js';

describe('Model Priority API - /api/users/:userId/model-priority', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    // Default mocks
    (initializeModelRegistryTable as jest.Mock).mockResolvedValue(undefined);
    (getUserModelPriority as jest.Mock).mockResolvedValue(null);
    (setUserModelPriority as jest.Mock).mockImplementation(async (userId: string, priorityList: string[]) => ({
      userId,
      priorityList,
      updatedAt: new Date(),
    }));
    (getSystemDefaultPriority as jest.Mock).mockResolvedValue({
      priorityList: ['veo3-low', 'veo3-high', 'runway-gen3'],
      updatedAt: new Date(),
    });

    app = express();
    app.use(express.json());
    app.use('/api', userPriorityRoutes);
  });

  const validUserId = '123e4567-e89b-12d3-a456-426614174000';

  describe('GET /api/users/:userId/model-priority', () => {
    test('returns system default when user has no config', async () => {
      (getUserModelPriority as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/users/${validUserId}/model-priority`)
        .expect(200);

      expect(response.body).toEqual({
        priority: {
          priorityList: ['veo3-low', 'veo3-high', 'runway-gen3'],
          updatedAt: expect.any(String),
        },
        isDefault: true,
      });
      expect(getUserModelPriority).toHaveBeenCalledWith(validUserId);
    });

    test('returns user config when user has custom priority', async () => {
      const userPriority = {
        userId: validUserId,
        priorityList: ['runway-gen3', 'veo3-low'],
        updatedAt: new Date(),
      };
      (getUserModelPriority as jest.Mock).mockResolvedValue(userPriority);

      const response = await request(app)
        .get(`/api/users/${validUserId}/model-priority`)
        .expect(200);

      expect(response.body).toEqual({
        priority: {
          userId: validUserId,
          priorityList: ['runway-gen3', 'veo3-low'],
          updatedAt: expect.any(String),
        },
        isDefault: false,
      });
    });

    test('returns 400 for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/users/invalid-uuid/model-priority')
        .expect(400);

      expect(response.body.errors).toBeDefined();
    });

    test('returns 500 on database error', async () => {
      (getUserModelPriority as jest.Mock).mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .get(`/api/users/${validUserId}/model-priority`)
        .expect(500);

      expect(response.body.error).toBe('Failed to get user priority');
    });
  });

  describe('PATCH /api/users/:userId/model-priority', () => {
    test('clears user priority when useSystemDefault=true', async () => {
      (getSystemDefaultPriority as jest.Mock).mockResolvedValue({
        priorityList: ['veo3-low', 'veo3-high', 'runway-gen3'],
        updatedAt: new Date(),
      });

      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['veo3-low'], useSystemDefault: true })
        .expect(200);

      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM user_model_priorities WHERE user_id = $1',
        [validUserId]
      );
      expect(response.body.isDefault).toBe(true);
      expect(response.body.priority.priorityList).toEqual(['veo3-low', 'veo3-high', 'runway-gen3']);
    });

    test('sets explicit priority when useSystemDefault=false with priorityList', async () => {
      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['runway-gen3', 'veo3-low'], useSystemDefault: false })
        .expect(200);

      expect(setUserModelPriority).toHaveBeenCalledWith(validUserId, ['runway-gen3', 'veo3-low']);
      expect(response.body.isDefault).toBe(false);
      expect(response.body.priority.userId).toBe(validUserId);
      expect(response.body.priority.priorityList).toEqual(['runway-gen3', 'veo3-low']);
    });

    test('sets explicit priority when useSystemDefault omitted with priorityList', async () => {
      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['runway-gen3', 'veo3-low'] })
        .expect(200);

      expect(setUserModelPriority).toHaveBeenCalledWith(validUserId, ['runway-gen3', 'veo3-low']);
      expect(response.body.isDefault).toBe(false);
    });

    test('returns 400 when useSystemDefault=false but no priorityList', async () => {
      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ useSystemDefault: false })
        .expect(400);

      expect(response.body.error).toBe('priorityList is required when useSystemDefault is false');
      expect(setUserModelPriority).not.toHaveBeenCalled();
    });

    test('returns 400 when priorityList is empty array', async () => {
      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: [], useSystemDefault: false })
        .expect(400);

      // express-validator validation runs first, returns { errors: [...] }
      expect(response.body.errors).toBeDefined();
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    test('returns 400 for invalid model ID in priorityList', async () => {
      (setUserModelPriority as jest.Mock).mockRejectedValue(new Error('Invalid model ID in priority list: unknown-model'));

      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['unknown-model'], useSystemDefault: false })
        .expect(400);

      expect(response.body.error).toBe('Invalid model ID in priority list: unknown-model');
    });

    test('returns 400 for invalid UUID', async () => {
      const response = await request(app)
        .patch('/api/users/invalid-uuid/model-priority')
        .send({ priorityList: ['veo3-low'], useSystemDefault: false })
        .expect(400);

      expect(response.body.errors).toBeDefined();
    });

    test('treats non-boolean useSystemDefault as falsy and uses priorityList', async () => {
      // Express-validator should reject non-boolean, but if it doesn't,
      // string "true" === true is false, so it falls through to priorityList
      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['veo3-low'], useSystemDefault: 'true' })
        .expect(200);

      // String "true" is not === true, so it uses priorityList
      expect(setUserModelPriority).toHaveBeenCalledWith(validUserId, ['veo3-low']);
      expect(response.body.isDefault).toBe(false);
    });

    test('returns 500 on database error during set', async () => {
      (setUserModelPriority as jest.Mock).mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['veo3-low'], useSystemDefault: false })
        .expect(500);

      expect(response.body.error).toBe('Failed to set user priority');
    });

    test('returns 500 when non-Error value is thrown during set', async () => {
      (setUserModelPriority as jest.Mock).mockRejectedValue('string error');

      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['veo3-low'], useSystemDefault: false })
        .expect(500);

      expect(response.body.error).toBe('Failed to set user priority');
    });

    test('returns 500 on database error during delete (useSystemDefault=true)', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .patch(`/api/users/${validUserId}/model-priority`)
        .send({ priorityList: ['veo3-low'], useSystemDefault: true })
        .expect(500);

      expect(response.body.error).toBe('Failed to set user priority');
    });
  });
});