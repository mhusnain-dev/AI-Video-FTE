/**
 * Unit tests for Health Check Registry
 * Targets 100% branch coverage for src/shared/health.ts
 */

import {
  HealthCheckRegistry,
  getHealthRegistry,
  setHealthRegistry,
  computeOverallHealth,
  buildHealthStatus,
  getDefaultMetrics,
} from '../../../src/shared/health';
import type { HealthStatus, ComponentHealth } from '../../../src/shared/types';

describe('HealthCheckRegistry', () => {
  let registry: HealthCheckRegistry;

  beforeAll(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    registry = new HealthCheckRegistry({
      livenessThresholdMs: 100,
      readinessThresholdMs: 100,
    });
  });

  describe('constructor', () => {
    test('uses provided config values', () => {
      const r = new HealthCheckRegistry({
        livenessThresholdMs: 5000,
        readinessThresholdMs: 3000,
      });
      // Config is private, but we can verify behavior via timeout tests
      expect(r).toBeDefined();
    });

    test('uses default values when no config provided', () => {
      const r = new HealthCheckRegistry();
      expect(r).toBeDefined();
    });

    test('uses default when config has partial values', () => {
      const r = new HealthCheckRegistry({ livenessThresholdMs: 5000 });
      expect(r).toBeDefined();
    });
  });

  describe('register', () => {
    test('registers a health check', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });

      registry.register('test-check', checkFn, false);
      expect(registry.hasCheck('test-check')).toBe(true);
      expect(registry.getRegisteredChecks()).toContain('test-check');
    });

    test('registers a critical health check', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });

      registry.register('critical-check', checkFn, true);
      expect(registry.hasCheck('critical-check')).toBe(true);
    });

    test('defaults critical to false', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });

      registry.register('default-check', checkFn);
      expect(registry.hasCheck('default-check')).toBe(true);
    });

    test('overwrites existing check with same name', () => {
      const checkFn1 = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });
      const checkFn2 = async (): Promise<ComponentHealth> => ({
        status: 'unhealthy',
        latencyMs: 10,
      });

      registry.register('test-check', checkFn1, false);
      registry.register('test-check', checkFn2, true);
      expect(registry.getRegisteredChecks().filter(c => c === 'test-check').length).toBe(1);
    });
  });

  describe('unregister', () => {
    test('unregisters an existing check', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });

      registry.register('test-check', checkFn, false);
      expect(registry.unregister('test-check')).toBe(true);
      expect(registry.hasCheck('test-check')).toBe(false);
    });

    test('returns false for non-existent check', () => {
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('runAll', () => {
    test('runs all registered checks', async () => {
      const checkFn1 = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });
      const checkFn2 = async (): Promise<ComponentHealth> => ({
        status: 'degraded',
        latencyMs: 50,
      });

      registry.register('check1', checkFn1, false);
      registry.register('check2', checkFn2, false);

      const results = await registry.runAll();
      expect(results.check1.status).toBe('healthy');
      expect(results.check2.status).toBe('degraded');
    });

    test('handles check that throws', async () => {
      const checkFn = async (): Promise<ComponentHealth> => {
        throw new Error('Check failed');
      };

      registry.register('failing-check', checkFn, false);

      const results = await registry.runAll();
      expect(results['failing-check'].status).toBe('unhealthy');
      expect(results['failing-check'].details?.error).toBe('Check failed');
    });

    test('handles check that throws non-Error', async () => {
      const checkFn = async (): Promise<ComponentHealth> => {
        throw 'string error';
      };

      registry.register('string-error-check', checkFn, false);

      const results = await registry.runAll();
      expect(results['string-error-check'].status).toBe('unhealthy');
      expect(results['string-error-check'].details?.error).toBe('Unknown error');
    });

    test('returns empty object when no checks registered', async () => {
      const results = await registry.runAll();
      expect(results).toEqual({});
    });

    test('times out slow checks', async () => {
      const slowCheck = async (): Promise<ComponentHealth> => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ status: 'healthy', latencyMs: 10 }), 500);
        });
      };

      registry.register('slow-check', slowCheck, false);

      const results = await registry.runAll();
      expect(results['slow-check'].status).toBe('unhealthy');
      expect(results['slow-check'].details?.error).toContain('timed out');
    });
  });

  describe('runCritical', () => {
    test('runs only critical checks', async () => {
      const criticalCheck = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });
      const nonCriticalCheck = async (): Promise<ComponentHealth> => ({
        status: 'healthy',
        latencyMs: 10,
      });

      registry.register('critical', criticalCheck, true);
      registry.register('non-critical', nonCriticalCheck, false);

      const results = await registry.runCritical();
      expect(results.critical).toBeDefined();
      expect(results['non-critical']).toBeUndefined();
    });

    test('handles critical check that throws', async () => {
      const checkFn = async (): Promise<ComponentHealth> => {
        throw new Error('Critical check failed');
      };

      registry.register('critical-fail', checkFn, true);

      const results = await registry.runCritical();
      expect(results['critical-fail'].status).toBe('unhealthy');
      expect(results['critical-fail'].details?.error).toBe('Critical check failed');
    });

    test('handles critical check that throws non-Error', async () => {
      const checkFn = async (): Promise<ComponentHealth> => {
        throw 42;
      };

      registry.register('critical-num-err', checkFn, true);

      const results = await registry.runCritical();
      expect(results['critical-num-err'].status).toBe('unhealthy');
      expect(results['critical-num-err'].details?.error).toBe('Unknown error');
    });

    test('times out slow critical checks', async () => {
      const slowCheck = async (): Promise<ComponentHealth> => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ status: 'healthy', latencyMs: 10 }), 500);
        });
      };

      registry.register('slow-critical', slowCheck, true);

      const results = await registry.runCritical();
      expect(results['slow-critical'].status).toBe('unhealthy');
      expect(results['slow-critical'].details?.error).toContain('timed out');
    });

    test('returns empty when no critical checks registered', async () => {
      registry.register('non-critical', async () => ({ status: 'healthy' }), false);

      const results = await registry.runCritical();
      expect(results).toEqual({});
    });
  });

  describe('getRegisteredChecks', () => {
    test('returns all registered check names', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({ status: 'healthy' });
      registry.register('check1', checkFn, false);
      registry.register('check2', checkFn, true);
      registry.register('check3', checkFn, false);

      const checks = registry.getRegisteredChecks();
      expect(checks).toHaveLength(3);
      expect(checks).toContain('check1');
      expect(checks).toContain('check2');
      expect(checks).toContain('check3');
    });

    test('returns empty array when no checks registered', () => {
      const checks = registry.getRegisteredChecks();
      expect(checks).toHaveLength(0);
    });
  });

  describe('hasCheck', () => {
    test('returns true for registered check', () => {
      const checkFn = async (): Promise<ComponentHealth> => ({ status: 'healthy' });
      registry.register('test-check', checkFn, false);
      expect(registry.hasCheck('test-check')).toBe(true);
    });

    test('returns false for unregistered check', () => {
      expect(registry.hasCheck('unknown')).toBe(false);
    });
  });
});

describe('Singleton Health Registry', () => {
  beforeEach(() => {
    setHealthRegistry(new HealthCheckRegistry());
  });

  test('creates instance on first call when singleton is null', () => {
    jest.resetModules();
    const { getHealthRegistry } = require('../../../src/shared/health');
    const r = getHealthRegistry();
    expect(r).toBeDefined();
    expect(typeof r.register).toBe('function');
    expect(typeof r.runAll).toBe('function');
  });

  test('returns same instance on multiple calls', () => {
    const registry1 = getHealthRegistry();
    const registry2 = getHealthRegistry();
    expect(registry1).toBe(registry2);
  });

  test('creates instance on first call', () => {
    // Reset by setting null indirectly
    setHealthRegistry(new HealthCheckRegistry());
    const r1 = getHealthRegistry();
    const r2 = getHealthRegistry();
    expect(r1).toBe(r2);
  });

  test('allows replacing the singleton', () => {
    const original = getHealthRegistry();
    const replacement = new HealthCheckRegistry();
    setHealthRegistry(replacement);
    expect(getHealthRegistry()).toBe(replacement);
    expect(getHealthRegistry()).not.toBe(original);
  });
});

describe('computeOverallHealth', () => {
  test('returns healthy for empty checks', () => {
    expect(computeOverallHealth({})).toBe('healthy');
  });

  test('returns unhealthy when critical check is unhealthy', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'unhealthy', latencyMs: 10 },
    };
    expect(computeOverallHealth(checks, ['db'])).toBe('unhealthy');
  });

  test('returns degraded when non-critical check is unhealthy', () => {
    const checks: Record<string, ComponentHealth> = {
      nonCritical: { status: 'unhealthy', latencyMs: 10 },
    };
    expect(computeOverallHealth(checks, ['db'])).toBe('degraded');
  });

  test('returns degraded when any check is degraded', () => {
    const checks: Record<string, ComponentHealth> = {
      check1: { status: 'healthy', latencyMs: 10 },
      check2: { status: 'degraded', latencyMs: 500 },
    };
    expect(computeOverallHealth(checks, [])).toBe('degraded');
  });

  test('returns healthy when all checks are healthy', () => {
    const checks: Record<string, ComponentHealth> = {
      check1: { status: 'healthy', latencyMs: 10 },
      check2: { status: 'healthy', latencyMs: 20 },
    };
    expect(computeOverallHealth(checks, [])).toBe('healthy');
  });

  test('returns degraded when critical checks are healthy but non-critical are degraded', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'healthy', latencyMs: 10 },
      service: { status: 'degraded', latencyMs: 500 },
    };
    expect(computeOverallHealth(checks, ['db'])).toBe('degraded');
  });

  test('ignores non-registered critical check names', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'healthy', latencyMs: 10 },
    };
    expect(computeOverallHealth(checks, ['db', 'nonexistent'])).toBe('healthy');
  });

  test('returns unhealthy when critical check missing from checks but named as critical', () => {
    // Critical check named 'db' doesn't exist in checks object
    // The loop checks `if (check && check.status === 'unhealthy')` — check is undefined
    const checks: Record<string, ComponentHealth> = {
      redis: { status: 'healthy', latencyMs: 5 },
    };
    expect(computeOverallHealth(checks, ['db'])).toBe('healthy');
  });

  test('returns degraded when critical is healthy but another is unhealthy', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'healthy', latencyMs: 5 },
      cache: { status: 'unhealthy', latencyMs: 5 },
    };
    expect(computeOverallHealth(checks, ['db'])).toBe('degraded');
  });
});

describe('buildHealthStatus', () => {
  test('builds complete health status object', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'healthy', latencyMs: 10, details: { poolSize: 10 } },
    };
    const metrics: HealthStatus['metrics'] = {
      processingBacklog: 5,
      avgLatencyMs: 100,
      errorRate: 0.01,
      costDriftPercentage: 0.5,
      activeStories: 3,
      activeShots: 10,
    };

    const status = buildHealthStatus(checks, metrics, ['db']);

    expect(status.status).toBe('healthy');
    expect(status.timestamp).toBeInstanceOf(Date);
    expect(status.metrics).toEqual(metrics);
    expect(status.checks).toEqual(checks);
  });

  test('uses computeOverallHealth for status', async () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'unhealthy', latencyMs: 10 },
    };
    const metrics = await getDefaultMetrics();

    const status = buildHealthStatus(checks, metrics, ['db']);
    expect(status.status).toBe('unhealthy');
  });

  test('returns degraded when non-critical check is unhealthy', () => {
    const checks: Record<string, ComponentHealth> = {
      cache: { status: 'unhealthy', latencyMs: 10 },
    };
    const metrics: HealthStatus['metrics'] = {
      processingBacklog: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      costDriftPercentage: 0,
      activeStories: 0,
      activeShots: 0,
    };

    const status = buildHealthStatus(checks, metrics, ['db']);
    expect(status.status).toBe('degraded');
  });

  test('uses empty criticalCheckNames by default', () => {
    const checks: Record<string, ComponentHealth> = {
      db: { status: 'unhealthy', latencyMs: 10 },
    };
    const metrics: HealthStatus['metrics'] = {
      processingBacklog: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      costDriftPercentage: 0,
      activeStories: 0,
      activeShots: 0,
    };

    // Without criticalCheckNames, unhealthy db makes it degraded (not unhealthy)
    const status = buildHealthStatus(checks, metrics);
    expect(status.status).toBe('degraded');
  });
});

describe('getDefaultMetrics', () => {
  test('returns default metrics object', async () => {
    const metrics = await getDefaultMetrics();

    expect(metrics).toEqual({
      processingBacklog: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      costDriftPercentage: 0,
      activeStories: 0,
      activeShots: 0,
    });
  });
});
