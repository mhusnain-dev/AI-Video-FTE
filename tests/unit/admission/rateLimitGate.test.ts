import { jest, describe, test, expect, beforeEach } from '@jest/globals';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    admission: {
      rateLimit: {
        perModel: {
          'kie-veo3-fast': 10,
          'kie-veo3-quality': 5,
          'kie-veo3-lite': 20,
        },
        perUser: 20,
        global: 100,
        perProjectOverrides: {},
      },
    },
  },
}));

import {
  checkRateLimit,
  recordRateLimitAudit,
  getRateLimitStatus,
} from '../../../src/admission/rateLimitGate';
import { config } from '../../../src/shared/config';

const mockQuery = require('../../../src/shared/db').query as jest.MockedFunction<any>;

function makeContext(overrides: Record<string, string> = {}) {
  return {
    storyId: 'story-1',
    shotId: 'shot-1',
    prompt: 'test prompt',
    referenceImages: [],
    modelId: 'kie-veo3-fast',
    userId: 'user-1',
    estimatedCost: 0.1,
    ...overrides,
  };
}

describe('rateLimitGate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('checkRateLimit', () => {
    test('allows when all limits are under threshold', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.scope).toBe('model');
    });

    test('blocks when per-model limit exceeded', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
      expect(result.currentUsage).toBe(10);
      expect(result.limit).toBe(10);
      expect(result.scope).toBe('model');
      expect(result.reason).toContain('kie-veo3-fast');
      expect(result.reason).toContain('10/10');
    });

    test('blocks when per-user limit exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '20' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
      expect(result.currentUsage).toBe(20);
      expect(result.limit).toBe(20);
      expect(result.scope).toBe('user');
      expect(result.reason).toContain('Per-user rate limit exceeded');
      expect(result.reason).toContain('20/20');
    });

    test('blocks when global limit exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ total: '100' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
      expect(result.currentUsage).toBe(100);
      expect(result.limit).toBe(100);
      expect(result.scope).toBe('global');
      expect(result.reason).toContain('Global rate limit exceeded');
      expect(result.reason).toContain('100/100');
    });

    test('uses default limit (10) for unknown model', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '9' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await checkRateLimit(makeContext({ modelId: 'unknown-model' }));

      expect(result.allowed).toBe(true);
    });

    test('blocks unknown model when usage exceeds default limit (10)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }] });

      const result = await checkRateLimit(makeContext({ modelId: 'unknown-model' }));

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.scope).toBe('model');
    });

    test('skips project usage recording when projectId is null', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(6);
    });

    test('blocks when project rate limit exceeded', async () => {
      const originalOverrides = (config as any).admission.rateLimit.perProjectOverrides;
      (config as any).admission.rateLimit.perProjectOverrides = {
        'proj-42': { global: 50 },
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // model
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // user
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // global
        .mockResolvedValueOnce({ rows: [{ total: '50' }] }); // project

      const result = await checkRateLimit(makeContext(), async () => 'proj-42');

      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('project');
      expect(result.currentUsage).toBe(50);
      expect(result.limit).toBe(50);
      expect(result.reason).toContain('Project rate limit exceeded');

      (config as any).admission.rateLimit.perProjectOverrides = originalOverrides;
    });

    test('records project usage when allowed and projectId exists', async () => {
      const originalOverrides = (config as any).admission.rateLimit.perProjectOverrides;
      (config as any).admission.rateLimit.perProjectOverrides = {
        'proj-42': { global: 100 },
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // model
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // user
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // global
        .mockResolvedValueOnce({ rows: [{ total: '10' }] }) // project
        .mockResolvedValueOnce({ rows: [] }) // record model
        .mockResolvedValueOnce({ rows: [] }) // record user
        .mockResolvedValueOnce({ rows: [] }) // record global
        .mockResolvedValueOnce({ rows: [] }); // record project

      const result = await checkRateLimit(makeContext(), async () => 'proj-42');

      expect(result.allowed).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(8);

      (config as any).admission.rateLimit.perProjectOverrides = originalOverrides;
    });

    test('falls back to global limit when project override has no global property', async () => {
      const originalOverrides = (config as any).admission.rateLimit.perProjectOverrides;
      (config as any).admission.rateLimit.perProjectOverrides = {
        'proj-42': {},
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // model
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // user
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // global
        .mockResolvedValueOnce({ rows: [{ total: '100' }] }); // project (uses global limit=100)

      const result = await checkRateLimit(makeContext(), async () => 'proj-42');

      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('project');
      expect(result.limit).toBe(100);

      (config as any).admission.rateLimit.perProjectOverrides = originalOverrides;
    });

    test('model check is first - returns immediately even if user/global OK', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('model');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('user check happens only after model check passes', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '20' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('user');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('global check happens after model and user pass', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ total: '100' }] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('global');
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test('returns correct remaining usage when allowed', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ total: '50' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkRateLimit(makeContext());

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(4);
    });

    test('uses kie-veo3-quality limit of 5', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '5' }] });

      const result = await checkRateLimit(makeContext({ modelId: 'kie-veo3-quality' }));

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(5);
      expect(result.scope).toBe('model');
    });

    test('uses kie-veo3-lite limit of 20', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '19' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await checkRateLimit(makeContext({ modelId: 'kie-veo3-lite' }));

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
    });
  });

  describe('recordRateLimitAudit', () => {
    test('records pass audit when result is allowed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordRateLimitAudit(
        makeContext(),
        { allowed: true, currentUsage: 5, limit: 10, scope: 'model' }
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admission_audit'),
        expect.arrayContaining([
          'story-1',
          'shot-1',
          'rate_limit',
          'pass',
          undefined,
          'rate_limit_exceeded',
          null,
          expect.any(String),
        ])
      );
    });

    test('records fail audit when result is not allowed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordRateLimitAudit(
        makeContext(),
        {
          allowed: false,
          retryAfterSeconds: 60,
          currentUsage: 10,
          limit: 10,
          scope: 'user',
          reason: 'Per-user rate limit exceeded',
        }
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admission_audit'),
        expect.arrayContaining([
          'story-1',
          'shot-1',
          'rate_limit',
          'fail',
          'Per-user rate limit exceeded',
          'rate_limit_exceeded',
          'rate_limit_user',
          expect.any(String),
        ])
      );
    });

    test('serializes full context as JSON', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordRateLimitAudit(
        makeContext(),
        { allowed: false, scope: 'global', currentUsage: 100, limit: 100, retryAfterSeconds: 60, reason: 'exceeded' }
      );

      const params = mockQuery.mock.calls[0][1] as any[];
      const fullContext = JSON.parse(params[7] as string);
      expect(fullContext).toEqual({
        modelId: 'kie-veo3-fast',
        userId: 'user-1',
        scope: 'global',
        currentUsage: 100,
        limit: 100,
        retryAfterSeconds: 60,
      });
    });

    test('audit includes null rule_triggered for pass results', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordRateLimitAudit(
        makeContext(),
        { allowed: true, scope: 'model', currentUsage: 1, limit: 10 }
      );

      const params = mockQuery.mock.calls[0][1] as any[];
      expect(params[4]).toBeUndefined();
    });

    test('audit includes rule_triggered as rate_limit_{scope} for failures', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordRateLimitAudit(
        makeContext(),
        { allowed: false, scope: 'global', currentUsage: 100, limit: 100, reason: 'exceeded' }
      );

      const params = mockQuery.mock.calls[0][1] as any[];
      expect(params[6]).toBe('rate_limit_global');
    });
  });

  describe('getRateLimitStatus', () => {
    test('returns current usage and limits for all scopes', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ total: '7' }] })
        .mockResolvedValueOnce({ rows: [{ total: '50' }] });

      const result = await getRateLimitStatus('user-1', 'kie-veo3-fast');

      expect(result.model.used).toBe(3);
      expect(result.model.limit).toBe(10);
      expect(result.model.remaining).toBe(7);

      expect(result.user.used).toBe(7);
      expect(result.user.limit).toBe(20);
      expect(result.user.remaining).toBe(13);

      expect(result.global.used).toBe(50);
      expect(result.global.limit).toBe(100);
      expect(result.global.remaining).toBe(50);
    });

    test('uses default limit (10) for unknown model', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await getRateLimitStatus('user-1', 'unknown-model');

      expect(result.model.limit).toBe(10);
      expect(result.model.remaining).toBe(5);
    });

    test('returns zero remaining when usage equals limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total: '20' }] })
        .mockResolvedValueOnce({ rows: [{ total: '100' }] });

      const result = await getRateLimitStatus('user-1', 'kie-veo3-fast');

      expect(result.model.remaining).toBe(0);
      expect(result.user.remaining).toBe(0);
      expect(result.global.remaining).toBe(0);
    });

    test('returns correct remaining when usage exceeds limit (clamped to 0)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '15' }] })
        .mockResolvedValueOnce({ rows: [{ total: '30' }] })
        .mockResolvedValueOnce({ rows: [{ total: '150' }] });

      const result = await getRateLimitStatus('user-1', 'kie-veo3-fast');

      expect(result.model.remaining).toBe(0);
      expect(result.user.remaining).toBe(0);
      expect(result.global.remaining).toBe(0);
    });

    test('returns zero remaining when usage is 0', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await getRateLimitStatus('user-1', 'kie-veo3-fast');

      expect(result.model.remaining).toBe(10);
      expect(result.user.remaining).toBe(20);
      expect(result.global.remaining).toBe(100);
    });

    test('returns correct limits for kie-veo3-quality', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await getRateLimitStatus('user-1', 'kie-veo3-quality');

      expect(result.model.limit).toBe(5);
      expect(result.model.remaining).toBe(2);
    });
  });
});
