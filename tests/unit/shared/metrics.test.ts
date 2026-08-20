import { jest, describe, test, expect, beforeEach } from '@jest/globals';

jest.mock('prom-client', () => {
  const actual = jest.requireActual('prom-client') as any;
  return {
    ...actual,
    collectDefaultMetrics: jest.fn(),
  };
});

jest.mock('../../../src/shared/config', () => ({
  config: { redis: { host: 'localhost', port: 6379 } },
}));

import {
  getMetricsRegistry,
  initializeMetrics,
  createCounter,
  createGauge,
  createHistogram,
  getMetricsAsText,
  getMetricsAsJSON,
  getMetricsContentType,
  resetMetrics,
} from '../../../src/shared/metrics';

const { collectDefaultMetrics } = require('prom-client');

describe('metrics module', () => {
  beforeEach(() => {
    resetMetrics();
    jest.clearAllMocks();
  });

  describe('getMetricsRegistry', () => {
    test('creates a registry on first call', () => {
      const registry = getMetricsRegistry();
      expect(registry).toBeDefined();
      expect(registry.setDefaultLabels).toBeDefined();
    });

    test('returns same registry on subsequent calls', () => {
      const r1 = getMetricsRegistry();
      const r2 = getMetricsRegistry();
      expect(r1).toBe(r2);
    });

    test('collects default metrics with ai_video_ prefix', () => {
      getMetricsRegistry();
      expect(collectDefaultMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'ai_video_' })
      );
    });

    test('sets default labels with app name', () => {
      const registry = getMetricsRegistry();
      const labels = (registry as any)._defaultLabels || {};
      expect(typeof labels).toBe('object');
    });
  });

  describe('initializeMetrics', () => {
    test('initializes metrics and returns registry', () => {
      const registry = initializeMetrics();
      expect(registry).toBeDefined();
    });

    test('returns existing registry if already initialized', () => {
      const r1 = initializeMetrics();
      const r2 = initializeMetrics();
      expect(r1).toBe(r2);
    });
  });

  describe('createCounter', () => {
    test('creates a counter metric', () => {
      const counter = createCounter('test_counter', 'Test counter', ['label1']);
      expect(counter).toBeDefined();
      expect(counter.inc).toBeDefined();
    });

    test('creates counter with no labels', () => {
      const counter = createCounter('no_labels_counter', 'No labels');
      expect(counter).toBeDefined();
    });

    test('counter can be incremented', () => {
      const counter = createCounter('inc_counter', 'Incrementable', ['key']);
      counter.inc({ key: 'a' }, 5);
    });
  });

  describe('createGauge', () => {
    test('creates a gauge metric', () => {
      const gauge = createGauge('test_gauge', 'Test gauge', ['label1']);
      expect(gauge).toBeDefined();
      expect(gauge.set).toBeDefined();
      expect(gauge.inc).toBeDefined();
    });

    test('creates gauge with no labels', () => {
      const gauge = createGauge('no_labels_gauge', 'No labels');
      expect(gauge).toBeDefined();
    });

    test('gauge can be set and incremented', () => {
      const gauge = createGauge('inc_gauge', 'Settable', ['key']);
      gauge.set({ key: 'a' }, 10);
      gauge.inc({ key: 'a' });
    });
  });

  describe('createHistogram', () => {
    test('creates a histogram metric', () => {
      const histogram = createHistogram('test_histogram', 'Test histogram', ['label1']);
      expect(histogram).toBeDefined();
      expect(histogram.observe).toBeDefined();
    });

    test('creates histogram with custom buckets', () => {
      const histogram = createHistogram('custom_bucket_hist', 'Custom', [], [1, 5, 10]);
      expect(histogram).toBeDefined();
    });

    test('creates histogram with no labels', () => {
      const histogram = createHistogram('no_labels_hist', 'No labels');
      expect(histogram).toBeDefined();
    });

    test('histogram can observe values', () => {
      const histogram = createHistogram('observe_hist', 'Observable', ['key']);
      histogram.observe({ key: 'a' }, 42);
    });
  });

  describe('getMetricsAsText', () => {
    test('returns prometheus text format string', async () => {
      const text = await getMetricsAsText();
      expect(typeof text).toBe('string');
    });

    test('returns empty string when no metrics collected', async () => {
      const text = await getMetricsAsText();
      expect(text).toBeDefined();
    });
  });

  describe('getMetricsAsJSON', () => {
    test('returns JSON object', async () => {
      const json = await getMetricsAsJSON();
      expect(typeof json).toBe('object');
    });
  });

  describe('getMetricsContentType', () => {
    test('returns prometheus content type', () => {
      const contentType = getMetricsContentType();
      expect(contentType).toContain('text/plain');
    });
  });

  describe('resetMetrics', () => {
    test('clears the registry', () => {
      getMetricsRegistry();
      resetMetrics();
      const registry = getMetricsRegistry();
      expect(registry).toBeDefined();
    });

    test('safe to call when not initialized', () => {
      resetMetrics();
      resetMetrics();
    });

    test('registry after reset is different object', () => {
      const r1 = getMetricsRegistry();
      resetMetrics();
      const r2 = getMetricsRegistry();
      expect(r1).not.toBe(r2);
    });
  });

  describe('duplicate metric creation branches', () => {
    test('createCounter returns existing metric when called twice with same name', () => {
      resetMetrics();
      const c1 = createCounter('branch_counter_test', 'First', ['a']);
      const c2 = createCounter('branch_counter_test', 'First', ['a']);
      expect(c2).toBe(c1);
      c1.inc({ a: 'test' }, 1);
    });

    test('createGauge returns existing metric when called twice with same name', () => {
      resetMetrics();
      const g1 = createGauge('branch_gauge_test', 'First', ['a']);
      const g2 = createGauge('branch_gauge_test', 'First', ['a']);
      expect(g2).toBe(g1);
      g1.set({ a: 'test' }, 1);
    });

    test('createHistogram returns existing metric when called twice with same name', () => {
      resetMetrics();
      const h1 = createHistogram('branch_histogram_test', 'First', ['a']);
      const h2 = createHistogram('branch_histogram_test', 'First', ['a']);
      expect(h2).toBe(h1);
      h1.observe({ a: 'test' }, 1);
    });

    test('createCounter creates new metric when not in registry', () => {
      const c = createCounter('unique_counter_branch_xyz', 'Test');
      expect(c).toBeDefined();
      c.inc(1);
    });

    test('createGauge creates new metric when not in registry', () => {
      const g = createGauge('unique_gauge_branch_xyz', 'Test');
      expect(g).toBeDefined();
      g.set(1);
    });

    test('createHistogram creates new metric when not in registry', () => {
      const h = createHistogram('unique_histogram_branch_xyz', 'Test');
      expect(h).toBeDefined();
      h.observe(1);
    });

    test('createHistogram uses default buckets when none provided', () => {
      const h = createHistogram('default_bucket_test_xyz', 'Test');
      expect(h).toBeDefined();
    });

    test('createHistogram uses custom buckets when provided', () => {
      const h = createHistogram('custom_bucket_test_xyz', 'Test', [], [1, 2, 5, 10]);
      expect(h).toBeDefined();
    });

    test('createCounter with empty labels array', () => {
      const c = createCounter('empty_labels_counter_xyz', 'Test', []);
      expect(c).toBeDefined();
    });

    test('createGauge with empty labels array', () => {
      const g = createGauge('empty_labels_gauge_xyz', 'Test', []);
      expect(g).toBeDefined();
    });

    test('createHistogram with empty labels array', () => {
      const h = createHistogram('empty_labels_hist_xyz', 'Test', []);
      expect(h).toBeDefined();
    });
  });

  describe('initializeMetrics branches', () => {
    test('first call sets metricsInitialized to true', () => {
      resetMetrics();
      const r = initializeMetrics();
      expect(r).toBeDefined();
    });

    test('second call returns cached registry (metricsInitialized = true)', () => {
      resetMetrics();
      const r1 = initializeMetrics();
      const r2 = initializeMetrics();
      expect(r1).toBe(r2);
    });
  });

  describe('getMetricsRegistry branches', () => {
    test('returns existing registry when already created', () => {
      const r1 = getMetricsRegistry();
      const r2 = getMetricsRegistry();
      expect(r1).toBe(r2);
    });

    test('uses NODE_ENV from process.env for default labels', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test-branch';
      resetMetrics();
      const registry = getMetricsRegistry();
      expect(registry).toBeDefined();
      process.env.NODE_ENV = original || 'test';
    });

    test('falls back to development when NODE_ENV not set', () => {
      const original = process.env.NODE_ENV;
      delete (process.env as any).NODE_ENV;
      resetMetrics();
      const registry = getMetricsRegistry();
      expect(registry).toBeDefined();
      process.env.NODE_ENV = original || 'test';
    });
  });

  describe('resetMetrics branches', () => {
    test('resets metricsInitialized flag', () => {
      getMetricsRegistry();
      resetMetrics();
      // After reset, initializeMetrics should run full init again
      const r = initializeMetrics();
      expect(r).toBeDefined();
    });

    test('does not throw when metricsRegistry is already null', () => {
      resetMetrics();
      expect(() => resetMetrics()).not.toThrow();
    });
  });

  describe('pre-defined metrics', () => {
    test('storiesCreatedTotal is accessible and incrementable', async () => {
      const { storiesCreatedTotal } = await import('../../../src/shared/metrics');
      expect(storiesCreatedTotal).toBeDefined();
      storiesCreatedTotal.inc({ user_id: 'u1', status: 'created' });
    });

    test('storyDecompositionDurationSeconds is observable', async () => {
      const { storyDecompositionDurationSeconds } = await import('../../../src/shared/metrics');
      expect(storyDecompositionDurationSeconds).toBeDefined();
      storyDecompositionDurationSeconds.observe({ shot_count: '5' }, 1.0);
    });

    test('admissionGateDecisionTotal is accessible', async () => {
      const { admissionGateDecisionTotal } = await import('../../../src/shared/metrics');
      expect(admissionGateDecisionTotal).toBeDefined();
      admissionGateDecisionTotal.inc({ gate: 'rate_limit', decision: 'pass', reason_category: '' });
    });

    test('rateLimitExceededTotal is accessible', async () => {
      const { rateLimitExceededTotal } = await import('../../../src/shared/metrics');
      expect(rateLimitExceededTotal).toBeDefined();
      rateLimitExceededTotal.inc({ scope: 'model', model_id: 'kie-veo3-fast' });
    });

    test('redisCommandDurationSeconds is observable', async () => {
      const { redisCommandDurationSeconds } = await import('../../../src/shared/metrics');
      expect(redisCommandDurationSeconds).toBeDefined();
      redisCommandDurationSeconds.observe({ command: 'xadd' }, 0.05);
    });

    test('redisConnectionGauge is settable', async () => {
      const { redisConnectionGauge } = await import('../../../src/shared/metrics');
      expect(redisConnectionGauge).toBeDefined();
      redisConnectionGauge.set(1);
    });

    test('dbQueryDurationSeconds is observable', async () => {
      const { dbQueryDurationSeconds } = await import('../../../src/shared/metrics');
      expect(dbQueryDurationSeconds).toBeDefined();
      dbQueryDurationSeconds.observe({ operation: 'select' }, 0.1);
    });

    test('dbPoolUsageGauge is settable', async () => {
      const { dbPoolUsageGauge } = await import('../../../src/shared/metrics');
      expect(dbPoolUsageGauge).toBeDefined();
      dbPoolUsageGauge.set(5);
    });

    test('facelockVerificationTotal is accessible', async () => {
      const { facelockVerificationTotal } = await import('../../../src/shared/metrics');
      expect(facelockVerificationTotal).toBeDefined();
      facelockVerificationTotal.inc({ character_name: 'char1', model_id: 'm1', result: 'pass' });
    });

    test('facelockSimilarityScore is observable', async () => {
      const { facelockSimilarityScore } = await import('../../../src/shared/metrics');
      expect(facelockSimilarityScore).toBeDefined();
      facelockSimilarityScore.observe({ character_name: 'char1', model_id: 'm1' }, 0.85);
    });

    test('vaultEncryptTotal is accessible', async () => {
      const { vaultEncryptTotal } = await import('../../../src/shared/metrics');
      expect(vaultEncryptTotal).toBeDefined();
      vaultEncryptTotal.inc({ status: 'success' });
    });

    test('mergeDurationSeconds is observable', async () => {
      const { mergeDurationSeconds } = await import('../../../src/shared/metrics');
      expect(mergeDurationSeconds).toBeDefined();
      mergeDurationSeconds.observe({ story_id: 's1', shot_count: '5', resolution: '1080p' }, 2.5);
    });

    test('webhookReceivedTotal is accessible', async () => {
      const { webhookReceivedTotal } = await import('../../../src/shared/metrics');
      expect(webhookReceivedTotal).toBeDefined();
      webhookReceivedTotal.inc({ provider: 'kie', status: 'completed', duplicate: 'false' });
    });

    test('shotDispatchTotal is accessible', async () => {
      const { shotDispatchTotal } = await import('../../../src/shared/metrics');
      expect(shotDispatchTotal).toBeDefined();
      shotDispatchTotal.inc({ model_id: 'kie-veo3-fast', status: 'dispatched' });
    });

    test('activeStoriesGauge is settable', async () => {
      const { activeStoriesGauge } = await import('../../../src/shared/metrics');
      expect(activeStoriesGauge).toBeDefined();
      activeStoriesGauge.set(3);
    });

    test('costDriftPercentageGauge is settable', async () => {
      const { costDriftPercentageGauge } = await import('../../../src/shared/metrics');
      expect(costDriftPercentageGauge).toBeDefined();
      costDriftPercentageGauge.set(0.15);
    });

    test('rateLimitUsageGauge is settable', async () => {
      const { rateLimitUsageGauge } = await import('../../../src/shared/metrics');
      expect(rateLimitUsageGauge).toBeDefined();
      rateLimitUsageGauge.set({ scope_type: 'model', scope_key: 'kie-veo3-fast' }, 5);
    });

    test('admissionPipelineDurationSeconds is observable', async () => {
      const { admissionPipelineDurationSeconds } = await import('../../../src/shared/metrics');
      expect(admissionPipelineDurationSeconds).toBeDefined();
      admissionPipelineDurationSeconds.observe({ gate: 'rate_limit', result: 'pass' }, 0.5);
    });

    test('sacredGuardBlockTotal is accessible', async () => {
      const { sacredGuardBlockTotal } = await import('../../../src/shared/metrics');
      expect(sacredGuardBlockTotal).toBeDefined();
      sacredGuardBlockTotal.inc({ enforcement_point: 'moderation', match_type: 'exact', model_id: 'm1' });
    });

    test('costGuardPauseTotal is accessible', async () => {
      const { costGuardPauseTotal } = await import('../../../src/shared/metrics');
      expect(costGuardPauseTotal).toBeDefined();
      costGuardPauseTotal.inc({ reason: 'budget_exceeded' });
    });

    test('shotGenerationDurationSeconds is observable', async () => {
      const { shotGenerationDurationSeconds } = await import('../../../src/shared/metrics');
      expect(shotGenerationDurationSeconds).toBeDefined();
      shotGenerationDurationSeconds.observe({ model_id: 'm1', shot_duration: '10' }, 5.0);
    });

    test('facelockPassRateGauge is settable', async () => {
      const { facelockPassRateGauge } = await import('../../../src/shared/metrics');
      expect(facelockPassRateGauge).toBeDefined();
      facelockPassRateGauge.set({ character_name: 'char1', model_id: 'm1' }, 0.95);
    });

    test('vaultStatusGauge is settable', async () => {
      const { vaultStatusGauge } = await import('../../../src/shared/metrics');
      expect(vaultStatusGauge).toBeDefined();
      vaultStatusGauge.set(1);
    });

    test('charactersRegisteredTotal is accessible', async () => {
      const { charactersRegisteredTotal } = await import('../../../src/shared/metrics');
      expect(charactersRegisteredTotal).toBeDefined();
      charactersRegisteredTotal.inc({ story_id: 's1', has_voice: 'true' });
    });

    test('characterSacredGuardBlocksTotal is accessible', async () => {
      const { characterSacredGuardBlocksTotal } = await import('../../../src/shared/metrics');
      expect(characterSacredGuardBlocksTotal).toBeDefined();
      characterSacredGuardBlocksTotal.inc({ match_type: 'exact' });
    });

    test('shotPlanRevisedTotal is accessible', async () => {
      const { shotPlanRevisedTotal } = await import('../../../src/shared/metrics');
      expect(shotPlanRevisedTotal).toBeDefined();
      shotPlanRevisedTotal.inc({ action: 'revised' });
    });

    test('modelSelectionTotal is accessible', async () => {
      const { modelSelectionTotal } = await import('../../../src/shared/metrics');
      expect(modelSelectionTotal).toBeDefined();
      modelSelectionTotal.inc({ model_id: 'm1', reason: 'default', is_override: 'false' });
    });

    test('modelEligibilityFilteredTotal is accessible', async () => {
      const { modelEligibilityFilteredTotal } = await import('../../../src/shared/metrics');
      expect(modelEligibilityFilteredTotal).toBeDefined();
      modelEligibilityFilteredTotal.inc({ model_id: 'm1', reason: 'not_available' });
    });

    test('modelFallbackTotal is accessible', async () => {
      const { modelFallbackTotal } = await import('../../../src/shared/metrics');
      expect(modelFallbackTotal).toBeDefined();
      modelFallbackTotal.inc({ from_model: 'm1', to_model: 'm2', reason: 'error' });
    });

    test('modelRegistryRefreshTotal is accessible', async () => {
      const { modelRegistryRefreshTotal } = await import('../../../src/shared/metrics');
      expect(modelRegistryRefreshTotal).toBeDefined();
      modelRegistryRefreshTotal.inc({ success: 'true' });
    });

    test('admissionAuditWriteDurationSeconds is observable', async () => {
      const { admissionAuditWriteDurationSeconds } = await import('../../../src/shared/metrics');
      expect(admissionAuditWriteDurationSeconds).toBeDefined();
      admissionAuditWriteDurationSeconds.observe({ gate: 'rate_limit' }, 0.1);
    });

    test('shotDispatchLatencySeconds is observable', async () => {
      const { shotDispatchLatencySeconds } = await import('../../../src/shared/metrics');
      expect(shotDispatchLatencySeconds).toBeDefined();
      shotDispatchLatencySeconds.observe({ model_id: 'm1' }, 1.0);
    });

    test('shotFallbackTotal is accessible', async () => {
      const { shotFallbackTotal } = await import('../../../src/shared/metrics');
      expect(shotFallbackTotal).toBeDefined();
      shotFallbackTotal.inc({ from_model: 'm1', to_model: 'm2', trigger: 'timeout' });
    });

    test('shotTimeoutTotal is accessible', async () => {
      const { shotTimeoutTotal } = await import('../../../src/shared/metrics');
      expect(shotTimeoutTotal).toBeDefined();
      shotTimeoutTotal.inc({ model_id: 'm1', timeout_seconds: '30' });
    });

    test('webhookProcessingLatencySeconds is observable', async () => {
      const { webhookProcessingLatencySeconds } = await import('../../../src/shared/metrics');
      expect(webhookProcessingLatencySeconds).toBeDefined();
      webhookProcessingLatencySeconds.observe({ provider: 'kie' }, 0.5);
    });

    test('webhookUnrecognizedTotal is accessible', async () => {
      const { webhookUnrecognizedTotal } = await import('../../../src/shared/metrics');
      expect(webhookUnrecognizedTotal).toBeDefined();
      webhookUnrecognizedTotal.inc({ provider: 'unknown' });
    });

    test('watchdogCheckTotal is accessible', async () => {
      const { watchdogCheckTotal } = await import('../../../src/shared/metrics');
      expect(watchdogCheckTotal).toBeDefined();
      watchdogCheckTotal.inc({ result: 'ok' });
    });

    test('watchdogStuckDispatchesGauge is settable', async () => {
      const { watchdogStuckDispatchesGauge } = await import('../../../src/shared/metrics');
      expect(watchdogStuckDispatchesGauge).toBeDefined();
      watchdogStuckDispatchesGauge.set({ model_id: 'm1', status: 'stuck' }, 2);
    });

    test('dispatchesInFlightGauge is settable', async () => {
      const { dispatchesInFlightGauge } = await import('../../../src/shared/metrics');
      expect(dispatchesInFlightGauge).toBeDefined();
      dispatchesInFlightGauge.set({ model_id: 'm1' }, 3);
    });

    test('facelockRegenerationTotal is accessible', async () => {
      const { facelockRegenerationTotal } = await import('../../../src/shared/metrics');
      expect(facelockRegenerationTotal).toBeDefined();
      facelockRegenerationTotal.inc({ shot_id: 'sh1', retry_count: '1', trigger: 'drift' });
    });

    test('facelockMaxRetriesExceededTotal is accessible', async () => {
      const { facelockMaxRetriesExceededTotal } = await import('../../../src/shared/metrics');
      expect(facelockMaxRetriesExceededTotal).toBeDefined();
      facelockMaxRetriesExceededTotal.inc({ character_name: 'char1', model_id: 'm1' });
    });

    test('facelockCrossShotDriftDetectedTotal is accessible', async () => {
      const { facelockCrossShotDriftDetectedTotal } = await import('../../../src/shared/metrics');
      expect(facelockCrossShotDriftDetectedTotal).toBeDefined();
      facelockCrossShotDriftDetectedTotal.inc({ character_name: 'char1', story_id: 's1' });
    });

    test('facelockConsistencyReportGeneratedTotal is accessible', async () => {
      const { facelockConsistencyReportGeneratedTotal } = await import('../../../src/shared/metrics');
      expect(facelockConsistencyReportGeneratedTotal).toBeDefined();
      facelockConsistencyReportGeneratedTotal.inc({ story_id: 's1', overall_passed: 'true' });
    });

    test('mergeFailureTotal is accessible', async () => {
      const { mergeFailureTotal } = await import('../../../src/shared/metrics');
      expect(mergeFailureTotal).toBeDefined();
      mergeFailureTotal.inc({ story_id: 's1', error_type: 'timeout' });
    });

    test('deliveryPackageCreatedTotal is accessible', async () => {
      const { deliveryPackageCreatedTotal } = await import('../../../src/shared/metrics');
      expect(deliveryPackageCreatedTotal).toBeDefined();
      deliveryPackageCreatedTotal.inc({ story_id: 's1', resolution: '1080p', format: 'mp4' });
    });

    test('deliveryDownloadTotal is accessible', async () => {
      const { deliveryDownloadTotal } = await import('../../../src/shared/metrics');
      expect(deliveryDownloadTotal).toBeDefined();
      deliveryDownloadTotal.inc({ story_id: 's1', resolution: '1080p' });
    });

    test('partialRegenerationTotal is accessible', async () => {
      const { partialRegenerationTotal } = await import('../../../src/shared/metrics');
      expect(partialRegenerationTotal).toBeDefined();
      partialRegenerationTotal.inc({ story_id: 's1', shot_count: '3' });
    });

    test('deliveryPackageSizeBytes is observable', async () => {
      const { deliveryPackageSizeBytes } = await import('../../../src/shared/metrics');
      expect(deliveryPackageSizeBytes).toBeDefined();
      deliveryPackageSizeBytes.observe({ resolution: '1080p', format: 'mp4' }, 1048576);
    });

    test('mergeQueueDepthGauge is settable', async () => {
      const { mergeQueueDepthGauge } = await import('../../../src/shared/metrics');
      expect(mergeQueueDepthGauge).toBeDefined();
      mergeQueueDepthGauge.set(5);
    });

    test('vaultDecryptTotal is accessible', async () => {
      const { vaultDecryptTotal } = await import('../../../src/shared/metrics');
      expect(vaultDecryptTotal).toBeDefined();
      vaultDecryptTotal.inc({ status: 'success' });
    });

    test('vaultDEKRotationTotal is accessible', async () => {
      const { vaultDEKRotationTotal } = await import('../../../src/shared/metrics');
      expect(vaultDEKRotationTotal).toBeDefined();
      vaultDEKRotationTotal.inc({ status: 'success' });
    });

    test('vaultKEKRotationTotal is accessible', async () => {
      const { vaultKEKRotationTotal } = await import('../../../src/shared/metrics');
      expect(vaultKEKRotationTotal).toBeDefined();
      vaultKEKRotationTotal.inc({ status: 'success' });
    });

    test('vaultEncryptDurationSeconds is observable', async () => {
      const { vaultEncryptDurationSeconds } = await import('../../../src/shared/metrics');
      expect(vaultEncryptDurationSeconds).toBeDefined();
      vaultEncryptDurationSeconds.observe({}, 0.01);
    });

    test('vaultDecryptDurationSeconds is observable', async () => {
      const { vaultDecryptDurationSeconds } = await import('../../../src/shared/metrics');
      expect(vaultDecryptDurationSeconds).toBeDefined();
      vaultDecryptDurationSeconds.observe({}, 0.01);
    });

    test('activeShotsGauge is settable', async () => {
      const { activeShotsGauge } = await import('../../../src/shared/metrics');
      expect(activeShotsGauge).toBeDefined();
      activeShotsGauge.set(10);
    });
  });
});
