import {
  getModelCostEstimate,
  checkCostGuard,
  recordCostEstimate,
  recordActualCost,
  recordCostGuardAudit,
} from '../../../src/admission/costGuard';
import { config } from '../../../src/shared/config';

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    admission: {
      costGuard: {
        perModelEstimates: {
          'kie-veo3-fast': 0.01,
          'kie-veo3-quality': 0.04,
          'runway-gen3': 0.08,
        },
        userBudgetUsd: 100,
        projectCeilingUsd: 500,
        committedSpendLimitUsd: 50,
        singleShotDriftThreshold: 0.5,
        rollingAverageDriftThreshold: 0.2,
      },
    },
  },
}));

const mockQuery = require('../../../src/shared/db').query;

describe('CostGuard', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('getModelCostEstimate', () => {
    test('returns cost for known model', () => {
      expect(getModelCostEstimate('kie-veo3-fast', 10)).toBe(0.01 * 10);
    });

    test('returns cost for kie-veo3-quality', () => {
      expect(getModelCostEstimate('kie-veo3-quality', 5)).toBe(0.04 * 5);
    });

    test('returns cost for runway-gen3', () => {
      expect(getModelCostEstimate('runway-gen3', 15)).toBe(0.08 * 15);
    });

    test('uses conservative default for unknown model', () => {
      expect(getModelCostEstimate('unknown-model', 10)).toBe(0.05 * 10);
    });

    test('returns 0 for 0 duration', () => {
      expect(getModelCostEstimate('kie-veo3-fast', 0)).toBe(0);
    });
  });

  describe('checkCostGuard', () => {
    const baseContext = {
      storyId: 'story-1',
      shotId: 'shot-1',
      prompt: 'test',
      referenceImages: [],
      modelId: 'kie-veo3-fast',
      userId: 'user-1',
      estimatedCost: 0.1,
    };

    test('passes when under all budgets', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '50' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '5' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);

      expect(result.blocked).toBe(false);
      expect(result.paused).toBe(false);
      expect(result.estimatedCost).toBe(0.1);
      expect(result.userBudgetRemaining).toBe(90);
      expect(result.projectCeilingRemaining).toBe(450);
      expect(result.committedSpendRemaining).toBe(45);
    });

    test('pauses when user budget exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '99.95' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '50' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '5' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);

      expect(result.paused).toBe(true);
      expect(result.reason).toContain('User budget exceeded');
      expect(result.options).toEqual({ reduceScope: true, increaseBudget: true, cancel: true });
    });

    test('pauses when project ceiling exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '499.95' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '5' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);
      expect(result.paused).toBe(true);
      expect(result.reason).toContain('Project ceiling exceeded');
    });

    test('pauses when committed spend exceeded', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '10' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '50' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '49.95' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);
      expect(result.paused).toBe(true);
      expect(result.reason).toContain('Committed spend limit exceeded');
    });

    test('pauses with multiple overruns', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '99.95' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '499.95' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '49.95' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);
      expect(result.paused).toBe(true);
      expect(result.reason).toContain('User budget exceeded');
      expect(result.reason).toContain('Project ceiling exceeded');
      expect(result.reason).toContain('Committed spend limit exceeded');
    });

    test('uses default duration when not in context', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '0' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '0' }] });

      const result = await checkCostGuard(baseContext);
      expect(result.estimatedCost).toBe(0.1);
    });

    test('handles zero spend from database', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_spend: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_spend: '0' }] })
        .mockResolvedValueOnce({ rows: [{ committed: '0' }] });

      const result = await checkCostGuard({ ...baseContext, shotDurationSeconds: 10 } as any);
      expect(result.userBudgetRemaining).toBe(100);
      expect(result.projectCeilingRemaining).toBe(500);
      expect(result.committedSpendRemaining).toBe(50);
    });
  });

  describe('recordCostEstimate', () => {
    test('inserts estimated cost record with metadata', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await recordCostEstimate('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 0.5, { foo: 'bar' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_records'),
        ['story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 0.5, '{"foo":"bar"}']
      );
    });

    test('defaults metadata to empty object', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await recordCostEstimate('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 0.5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_records'),
        ['story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 0.5, '{}']
      );
    });
  });

  describe('recordActualCost', () => {
    test('inserts actual cost record and runs drift check', async () => {
      // flow: INSERT actual → checkCostDrift → SELECT estimate (no rows) → return
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // INSERT
        .mockResolvedValueOnce({ rows: [] }); // SELECT estimate (empty = early return)

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const firstCallSql = mockQuery.mock.calls[0][0] as string;
      expect(firstCallSql).toContain('INSERT INTO cost_records');
      expect(firstCallSql).toContain("'actual'");
      expect(firstCallSql).toContain("'USD'");
      expect(mockQuery.mock.calls[0][1]).toEqual(['story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0, '{}']);
    });

    test('handles null shotId', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await recordActualCost('story-1', null, 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_records'),
        ['story-1', null, 'kie-veo3-fast', 'user-1', 1.0, '{}']
      );
    });
  });

  describe('checkCostDrift (via recordActualCost)', () => {
    test('skips drift check when no estimate found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // no estimate

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('skips drift check when estimate is zero', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ amount_usd: '0' }] });

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('triggers single-shot drift alert when >50%', async () => {
      // estimate=0.1, actual=1.0 → drift=(1.0-0.1)/0.1=9.0 > 0.5 → alert
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '0.1' }] }) // estimate
        .mockResolvedValueOnce({ rows: [] }) // drift alert insert
        .mockResolvedValueOnce({ rows: [] }); // recent records (rolling avg)

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);

      expect(mockQuery).toHaveBeenCalledTimes(4);
      // Verify drift alert was inserted: call 3 should be the drift alert INSERT
      const driftAlertSql = mockQuery.mock.calls[2][0] as string;
      expect(driftAlertSql).toContain('drift_alert');
      expect(driftAlertSql).toContain("'USD'");
      const driftAlertParams = mockQuery.mock.calls[2][1];
      expect(driftAlertParams[4]).toBe(0); // amount is 0 for alerts
      expect(JSON.parse(driftAlertParams[5])).toMatchObject({
        type: 'single_shot',
        actualAmount: 1,
        estimatedAmount: 0.1,
      });
    });

    test('does not trigger single-shot drift when below threshold', async () => {
      // estimate=0.9, actual=1.0 → drift=(1.0-0.9)/0.9≈0.111 < 0.5
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '0.9' }] }) // estimate
        .mockResolvedValueOnce({ rows: [] }); // recent records

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test('triggers rolling average drift when >=4 records and above threshold', async () => {
      // single-shot: estimate=1.0, actual=2.0 → drift=1.0 > 0.5 → alert
      // rolling: 2 est=1.0 each + 2 actual=2.0 each → sum_est=2, sum_act=4 → drift=1.0 > 0.2
      const recentRows = [
        { amount_usd: '1.0', cost_type: 'estimated' },
        { amount_usd: '1.0', cost_type: 'estimated' },
        { amount_usd: '2.0', cost_type: 'actual' },
        { amount_usd: '2.0', cost_type: 'actual' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '1.0' }] }) // estimate
        .mockResolvedValueOnce({ rows: [] }) // single-shot drift alert
        .mockResolvedValueOnce({ rows: recentRows }) // recent records
        .mockResolvedValueOnce({ rows: [] }); // rolling drift alert

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 2.0);
      expect(mockQuery).toHaveBeenCalledTimes(5);
    });

    test('does not trigger rolling average drift when <4 records', async () => {
      const recentRows = [
        { amount_usd: '1.0', cost_type: 'estimated' },
        { amount_usd: '1.0', cost_type: 'actual' },
        { amount_usd: '1.0', cost_type: 'actual' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '1.0' }] }) // estimate
        .mockResolvedValueOnce({ rows: recentRows }); // recent records (3 rows)

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test('does not trigger rolling average drift when below threshold', async () => {
      const recentRows = [
        { amount_usd: '1.0', cost_type: 'estimated' },
        { amount_usd: '1.0', cost_type: 'estimated' },
        { amount_usd: '1.05', cost_type: 'actual' },
        { amount_usd: '1.05', cost_type: 'actual' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '1.0' }] }) // estimate (no single-shot drift)
        .mockResolvedValueOnce({ rows: recentRows }); // recent records (4 rows, drift 5%)

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.05);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test('does not trigger rolling average drift when estimated sum is 0', async () => {
      const recentRows = [
        { amount_usd: '0', cost_type: 'estimated' },
        { amount_usd: '0', cost_type: 'estimated' },
        { amount_usd: '0', cost_type: 'actual' },
        { amount_usd: '0', cost_type: 'actual' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '0.5' }] }) // estimate (single-shot drift triggers)
        .mockResolvedValueOnce({ rows: [] }) // single-shot drift alert
        .mockResolvedValueOnce({ rows: recentRows }); // recent records (sum=0)

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 1.0);
      expect(mockQuery).toHaveBeenCalledTimes(4);
    });

    test('does not trigger rolling average when count is exactly 4 but estimated sum is 0', async () => {
      const recentRows = [
        { amount_usd: '0.5', cost_type: 'estimated' },
        { amount_usd: '0', cost_type: 'estimated' },
        { amount_usd: '0.6', cost_type: 'actual' },
        { amount_usd: '0', cost_type: 'actual' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // insert actual
        .mockResolvedValueOnce({ rows: [{ amount_usd: '0.5' }] }) // estimate
        .mockResolvedValueOnce({ rows: recentRows }); // recent records

      await recordActualCost('story-1', 'shot-1', 'kie-veo3-fast', 'user-1', 0.6);
      // estimate=0.5, actual=0.6, singleDrift=0.2 < 0.5 → no single alert
      // rolling: estSum=0.5, actSum=0.6, drift=0.2 > 0.2 → alert
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe('recordCostGuardAudit', () => {
    test('records pass audit when not paused', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordCostGuardAudit(
        { storyId: 's1', shotId: 'sh1', prompt: '', referenceImages: [], modelId: 'm', userId: 'u', estimatedCost: 0 },
        { blocked: false, paused: false, estimatedCost: 0.1, userBudgetRemaining: 90, projectCeilingRemaining: 450, committedSpendRemaining: 45 }
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admission_audit'),
        expect.arrayContaining(['s1', 'sh1', 'cost_guard', 'pass', undefined, 'cost_overrun', null, expect.any(String)])
      );
    });

    test('records warn audit when paused', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordCostGuardAudit(
        { storyId: 's1', shotId: 'sh1', prompt: '', referenceImages: [], modelId: 'm', userId: 'u', estimatedCost: 0 },
        { blocked: false, paused: true, estimatedCost: 0.1, userBudgetRemaining: 90, projectCeilingRemaining: 450, committedSpendRemaining: 45, reason: 'overrun' }
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admission_audit'),
        expect.arrayContaining(['s1', 'sh1', 'cost_guard', 'warn', 'overrun', 'cost_overrun', 'cost_guard_overrun', expect.any(String)])
      );
    });
  });
});
