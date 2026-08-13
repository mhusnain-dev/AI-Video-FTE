/**
 * Unit tests for Admission Control Pipeline (Phase 3)
 */

import { checkModeration } from '../../../src/admission/moderationGate';
import { checkSacredGuard, addToDenylist, approveDenylistEntry } from '../../../src/admission/sacredGuard';
import { checkCostGuard } from '../../../src/admission/costGuard';
import { checkRateLimit } from '../../../src/admission/rateLimitGate';
import { runAdmissionPipeline } from '../../../src/admission/admissionController';
import type { AdmissionContext } from '../../../src/shared/types';

// Mock database
jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    admission: {
      moderation: {
        provider: 'built-in',
        categories: ['violence', 'sexual_content', 'hate', 'pii', 'csam'],
        threshold: 0.8,
      },
      sacredGuard: {
        visualSimilarityThreshold: 0.775,
        perModelThresholds: {
          'veo3-low': 0.78,
          'veo3-high': 0.77,
        },
      },
      costGuard: {
        perModelEstimates: {
          'veo3-low': 0.00,
          'veo3-high': 0.05,
        },
        userBudgetUsd: 100.00,
        projectCeilingUsd: 500.00,
        committedSpendLimitUsd: 50.00,
        singleShotDriftThreshold: 0.50,
        rollingAverageDriftThreshold: 0.20,
      },
      rateLimit: {
        perModel: { 'veo3-low': 10, 'veo3-high': 5, 'runway-gen3': 5 },
        perUser: 20,
        global: 100,
        perProjectOverrides: {},
      },
    },
  },
}));

jest.mock('../../../src/shared/events', () => ({
  shotStateMachine: {
    setCurrentState: jest.fn(),
    getCurrentState: jest.fn(),
  },
}));

const mockQuery = require('../../../src/shared/db').query;
const { resetDenylistCache } = require('../../../src/admission/sacredGuard');

describe('Admission Control Pipeline', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resetDenylistCache();
  });

  describe('Moderation Gate', () => {
    test('passes clean content', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'A beautiful sunset over mountains',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkModeration(context);
      expect(result.blocked).toBe(false);
    });

    test('blocks violence', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'A person kills another with a gun',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkModeration(context);
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('violence');
    });

    test('blocks sexual content', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Explicit pornographic content',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkModeration(context);
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('sexual_content');
    });

    test('blocks PII', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Contact me at john@example.com or 555-123-4567',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkModeration(context);
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('pii');
    });

    test('blocks CSAM', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Child pornography content',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkModeration(context);
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('csam');
    });
  });

  describe('Sacred Guard', () => {
    test('blocks exact match', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'deny-1', entity_name: 'Prophet Muhammad', entity_type: 'person', match_type: 'exact', embedding: null, is_active: true, approved_by_2: 'user-2' }] });

      const result = await checkSacredGuard({
        prompt: 'A depiction of Prophet Muhammad',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        enforcementPoint: 'pre_dispatch',
      });

      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('exact');
    });

    test('blocks transliterated match', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'deny-1', entity_name: 'Muhammed', entity_type: 'person', match_type: 'transliterated', embedding: null, is_active: true, approved_by_2: 'user-2' }] });

      const result = await checkSacredGuard({
        prompt: 'A drawing of Muhammed', // Different transliteration
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        enforcementPoint: 'pre_dispatch',
      });

      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('transliterated');
    });

    test('blocks fuzzy match', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'deny-1', entity_name: 'Muhammad', entity_type: 'person', match_type: 'fuzzy', embedding: null, is_active: true, approved_by_2: 'user-2' }] });

      const result = await checkSacredGuard({
        prompt: 'A picture of Muhamed', // 1 char difference
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        enforcementPoint: 'pre_dispatch',
      });

      expect(result.blocked).toBe(true);
      expect(result.matchType).toBe('fuzzy');
    });

    test('passes clean prompt', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await checkSacredGuard({
        prompt: 'A beautiful landscape',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        enforcementPoint: 'pre_dispatch',
      });

      expect(result.blocked).toBe(false);
    });
  });

  describe('Cost Guard', () => {
    test('passes within budget', async () => {
      // Mock the 3 queries: user spend, project spend, committed spend
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '10.00' }] }) // user spend
        .mockResolvedValueOnce({ rows: [{ total_spend: '50.00' }] }) // project spend
        .mockResolvedValueOnce({ rows: [{ committed: '5.00' }] }); // committed

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Test',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkCostGuard(context);
      expect(result.paused).toBe(false);
    });

    test('pauses on user budget overrun', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '99.99' }] }) // user spend near limit
        .mockResolvedValueOnce({ rows: [{ total_spend: '50.00' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '5.00' }] });

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Test',
        referenceImages: [],
        modelId: 'veo3-high', // $0.05/s * 10s = $0.50
        userId: 'user-1',
        estimatedCost: 0,
      };
      (context as any).shotDurationSeconds = 10;

      const result = await checkCostGuard(context);
      expect(result.paused).toBe(true);
      expect(result.reason).toContain('User budget exceeded');
      expect(result.options).toBeDefined();
    });
  });

  describe('Rate Limit Gate', () => {
    test('allows under limit', async () => {
      mockQuery.mockResolvedValue({ rows: [{ total: '5' }] });

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Test',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkRateLimit(context);
      expect(result.allowed).toBe(true);
    });

    test('blocks at per-model limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '10' }] }) // model usage at limit
        .mockResolvedValue({ rows: [{ total: '5' }] }); // others

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Test',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await checkRateLimit(context);
      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('model');
    });
  });

  describe('Admission Pipeline Order (CON-001)', () => {
    test('moderation blocks before sacred guard', async () => {
      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'Violence and sacred entity together', // Both moderation and sacred guard would trigger
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await runAdmissionPipeline(context);

      // Moderation should block first (order: moderation → sacred_guard)
      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('moderation');
      expect(result.results.moderation.blocked).toBe(true);
      expect(result.results.sacredGuard.blocked).toBe(false); // Never reached
    });

    test('sacred guard blocks before cost guard', async () => {
      // Clean prompt that passes moderation but triggers sacred guard
      // Use SQL pattern matching for robust mocking
      const queryMock = mockQuery as jest.Mock;
      queryMock.mockImplementation((sql: string, params: any[]) => {
        // Moderation audit insert
        if (sql.includes('INSERT INTO admission_audit') && sql.includes("gate = 'moderation'")) {
          return Promise.resolve({ rows: [] });
        }
        // Sacred guard denylist select - return the denylist entry
        if (sql.includes('SELECT id, entity_name, entity_type, match_type, embedding') && sql.includes('FROM sacred_denylist')) {
          return Promise.resolve({ rows: [{ id: 'deny-1', entity_name: 'SacredEntity', entity_type: 'person', match_type: 'exact', embedding: null, is_active: true, approved_by_2: 'user-2' }] });
        }
        // Sacred guard audit insert
        if (sql.includes('INSERT INTO admission_audit') && sql.includes("gate = 'sacred_guard'")) {
          return Promise.resolve({ rows: [] });
        }
        // Default fallback - shouldn't reach cost guard
        return Promise.resolve({ rows: [] });
      });

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'A picture of SacredEntity',
        referenceImages: [],
        modelId: 'veo3-low',
        userId: 'user-1',
        estimatedCost: 0,
      };

      const result = await runAdmissionPipeline(context);

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('sacred_guard');
      expect(result.results.moderation.blocked).toBe(false);
      expect(result.results.sacredGuard.blocked).toBe(true);
      expect(result.results.costGuard.paused).toBe(false); // Never reached
    });

    test('cost guard pauses before rate limit', async () => {
      // Clean prompt that passes moderation and sacred guard
      // Use SQL pattern matching for robust mocking regardless of audit query count
      const queryMock = mockQuery as jest.Mock;
      queryMock.mockImplementation((sql: string, params: any[]) => {
        // Moderation audit insert
        if (sql.includes('INSERT INTO admission_audit') && sql.includes("gate = 'moderation'")) {
          return Promise.resolve({ rows: [] });
        }
        // Sacred guard denylist select
        if (sql.includes('SELECT id, entity_name, entity_type, match_type, embedding') && sql.includes('FROM sacred_denylist')) {
          return Promise.resolve({ rows: [] });
        }
        // Sacred guard audit insert
        if (sql.includes('INSERT INTO admission_audit') && sql.includes("gate = 'sacred_guard'")) {
          return Promise.resolve({ rows: [] });
        }
        // Cost guard user spend select
        if (sql.includes('SELECT COALESCE(SUM(amount_usd), 0) as total_spend') && sql.includes('WHERE user_id = $1')) {
          return Promise.resolve({ rows: [{ total_spend: '99.99' }] });
        }
        // Cost guard project spend select
        if (sql.includes('SELECT COALESCE(SUM(amount_usd), 0) as total_spend') && sql.includes('WHERE story_id = $1')) {
          return Promise.resolve({ rows: [{ total_spend: '50.00' }] });
        }
        // Cost guard committed spend select
        if (sql.includes('SELECT COALESCE(SUM(estimated_cost), 0) as committed') && sql.includes('FROM shots')) {
          return Promise.resolve({ rows: [{ committed: '5.00' }] });
        }
        // Cost guard audit insert
        if (sql.includes('INSERT INTO admission_audit') && sql.includes("gate = 'cost_guard'")) {
          return Promise.resolve({ rows: [] });
        }
        // Default fallback
        return Promise.resolve({ rows: [] });
      });

      const context: AdmissionContext = {
        storyId: 'story-1',
        shotId: 'shot-1',
        prompt: 'A beautiful landscape',
        referenceImages: [],
        modelId: 'veo3-high',
        userId: 'user-1',
        estimatedCost: 0,
      };
      (context as any).shotDurationSeconds = 10;

      const result = await runAdmissionPipeline(context);

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('cost_guard');
      expect(result.results.moderation.blocked).toBe(false);
      expect(result.results.sacredGuard.blocked).toBe(false);
      expect(result.results.costGuard.paused).toBe(true);
      expect(result.results.rateLimit.allowed).toBe(true); // Never reached
    });
  });

  describe('Dual-Authorization (CL-009)', () => {
    test('addToDenylist requires two approvals', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // audit

      const id = await addToDenylist('Test Entity', 'person', 'exact', 'user-1');

      // Second approval needed
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id, entity_name: 'Test Entity', entity_type: 'person', match_type: 'exact', is_active: false, added_by: 'user-1', approved_by_1: 'user-1', approved_by_2: null }] })
        .mockResolvedValueOnce({ rows: [] });

      await approveDenylistEntry(id, 'user-2');

      // Should now be active
      const checkQuery = mockQuery.mock.calls.find((call: any[]) =>
        call[0].includes('UPDATE sacred_denylist SET approved_by_2')
      );
      expect(checkQuery).toBeDefined();
    });
  });
});