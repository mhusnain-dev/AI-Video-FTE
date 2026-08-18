/**
 * Health Check Routes
 * Implements FR-034, NFR-001, NFR-002, NFR-003, AC-029
 * Provides /health, /health/live, /health/ready, /health/startup, /health/<service>, /metrics
 */

import { Request, Response } from 'express';
import { config } from '../shared/config.js';
import { getPool, healthCheck as dbHealthCheck } from '../shared/db.js';
import { getRedis, closeRedis } from '../shared/redis.js';
import { getVaultClient, initializeVaultKey } from '../shared/vault.js';
import { getMetricsRegistry, getMetricsAsText, getMetricsContentType, initializeMetrics } from '../shared/metrics.js';
import { getHealthRegistry, HealthCheckFn, buildHealthStatus, getDefaultMetrics, computeOverallHealth } from '../shared/health.js';

// ============================================================================
// Service Health Check Implementations
// ============================================================================

/**
 * Infrastructure health checks
 */
export async function checkDatabase(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const healthy = await dbHealthCheck();
    const latencyMs = Date.now() - start;
    const pool = getPool();
    return {
      status: healthy ? 'healthy' : 'unhealthy',
      latencyMs,
      details: {
        poolSize: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

export async function checkRedis(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const r = getRedis();
    await r.ping();
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: { status: 'connected' },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

export async function checkVault(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const client = getVaultClient();
    // Use the correct node-vault API - read key metadata
    await client.read(`transit/keys/${config.vault.transitKeyName}`);
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 200 ? 'healthy' : 'degraded',
      latencyMs,
      details: { key: config.vault.transitKeyName },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

/**
 * Service-specific health checks
 */

 // Ingestion service
export async function checkIngestion(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    // Check database connectivity for stories table
    const pool = getPool();
    await pool.query('SELECT 1 FROM stories LIMIT 1');
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: { tables: ['stories', 'shots', 'characters'] },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Router service
export async function checkRouter(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    // Check model registry config
    const modelCount = config.modelRegistry.models.length;
    const latencyMs = Date.now() - start;
    return {
      status: modelCount > 0 ? 'healthy' : 'degraded',
      latencyMs,
      details: { eligibleModels: modelCount, lastRefresh: 'config' },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Admission service
export async function checkAdmission(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const pool = getPool();
    // Check budget, rate limit, sacred guard tables
    await pool.query('SELECT 1 FROM admission_audit LIMIT 1');
    await pool.query('SELECT 1 FROM cost_records LIMIT 1');
    await pool.query('SELECT 1 FROM rate_limit_counters LIMIT 1');
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: {
        userBudgetRemaining: config.admission.costGuard.userBudgetUsd,
        projectCeilingRemaining: config.admission.costGuard.projectCeilingUsd,
        globalRateLimit: config.admission.rateLimit.global,
        sacredGuardDenylistSize: config.admission.sacredGuard.perModelThresholds ? Object.keys(config.admission.sacredGuard.perModelThresholds).length : 0,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Dispatch service
export async function checkDispatch(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const pool = getPool();
    await pool.query('SELECT 1 FROM dispatch_records LIMIT 1');
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: {
        adapters: Object.keys(config.dispatch.defaultTimeouts),
        watchdogPollIntervalMs: config.dispatch.watchdogPollIntervalMs,
        watchdogMaxWaitMs: config.dispatch.watchdogMaxWaitMs,
        maxFallbackAttempts: config.dispatch.maxFallbackAttempts,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Face-Lock service
export async function checkFaceLock(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const pool = getPool();
    await pool.query('SELECT 1 FROM face_lock_verifications LIMIT 1');
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: {
        models: Object.keys(config.faceLock.defaultPerModelThresholds),
        maxRetries: config.faceLock.maxRetries,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Merger service
export async function checkMerger(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}> {
  const start = Date.now();
  try {
    const pool = getPool();
    await pool.query('SELECT 1 FROM delivery_packages LIMIT 1');
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
      details: {
        ffmpegPath: config.merger.ffmpegPath,
        supportedFormats: config.merger.supportedFormats,
        defaultTransition: config.merger.defaultTransition,
        maxMergeTimeMs: config.merger.maxMergeTimeMs,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// ============================================================================
// Health Registry Setup
// ============================================================================

let healthChecksRegistered = false;

export function registerHealthChecks(): void {
  if (healthChecksRegistered) return;

  const registry = getHealthRegistry();

  // Infrastructure (critical for liveness)
  registry.register('database', checkDatabase, true);
  registry.register('redis', checkRedis, true);
  registry.register('vault', checkVault, true);

  // Services
  registry.register('ingestion', checkIngestion, false);
  registry.register('router', checkRouter, false);
  registry.register('admission', checkAdmission, false);
  registry.register('dispatch', checkDispatch, false);
  registry.register('facelock', checkFaceLock, false);
  registry.register('merger', checkMerger, false);

  healthChecksRegistered = true;
}

// ============================================================================
// HTTP Route Handlers
// ============================================================================

/**
 * Liveness probe - checks if process is alive
 * Only checks critical infrastructure
 */
export async function handleHealthLive(req: Request, res: Response): Promise<void> {
  try {
    const registry = getHealthRegistry();
    const checks = await registry.runCritical();
    const status = computeOverallHealth(checks, ['database', 'redis', 'vault']);

    const httpStatus = status === 'unhealthy' ? 503 : 200;

    res.status(httpStatus).json({
      status,
      timestamp: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Readiness probe - checks if service can handle requests
 * Checks all infrastructure and services
 */
export async function handleHealthReady(req: Request, res: Response): Promise<void> {
  try {
    const registry = getHealthRegistry();
    const checks = await registry.runAll();
    const criticalNames = ['database', 'redis', 'vault'];
    const status = computeOverallHealth(checks, criticalNames);

    const httpStatus = status === 'unhealthy' ? 503 : 200;

    res.status(httpStatus).json({
      status,
      timestamp: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Startup probe - checks if service has completed startup
 * Same as readiness but allows longer timeout
 */
export async function handleHealthStartup(req: Request, res: Response): Promise<void> {
  try {
    const registry = getHealthRegistry();
    const checks = await registry.runAll();
    const criticalNames = ['database', 'redis', 'vault'];
    const status = computeOverallHealth(checks, criticalNames);

    const httpStatus = status === 'unhealthy' ? 503 : 200;

    res.status(httpStatus).json({
      status,
      timestamp: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Aggregate health endpoint - full health status with metrics
 */
export async function handleHealth(req: Request, res: Response): Promise<void> {
  try {
    const registry = getHealthRegistry();
    const checks = await registry.runAll();
    const criticalNames = ['database', 'redis', 'vault'];
    const status = computeOverallHealth(checks, criticalNames);

    // Get operational metrics
    const metrics = await getDefaultMetrics();

    // Try to get real metrics from database
    try {
      const pool = getPool();
      const [storiesResult, shotsResult, costResult] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM stories WHERE status IN ('in_progress', 'generating', 'merging')"),
        pool.query("SELECT COUNT(*) FROM shots WHERE status IN ('dispatched', 'generating', 'timeout')"),
        pool.query("SELECT COALESCE(SUM(amount_usd), 0) FROM cost_records WHERE cost_type = 'drift_alert'"),
      ]);

      metrics.activeStories = parseInt(storiesResult.rows[0].count, 10);
      metrics.activeShots = parseInt(shotsResult.rows[0].count, 10);
      metrics.costDriftPercentage = parseFloat(costResult.rows[0].sum) || 0;
    } catch {
      // Use defaults if queries fail
    }

    const healthStatus = buildHealthStatus(checks, metrics, criticalNames);

    // Always return 200 for /health - health status is in JSON body
    // This allows clients to programmatically check health without HTTP error handling
    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      metrics: await getDefaultMetrics(),
      checks: {},
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Individual service health endpoint
 */
export async function handleServiceHealth(req: Request, res: Response): Promise<void> {
  const service = req.params.service;
  const checks: Record<string, () => Promise<any>> = {
    ingestion: checkIngestion,
    router: checkRouter,
    admission: checkAdmission,
    dispatch: checkDispatch,
    facelock: checkFaceLock,
    merger: checkMerger,
  };

  const checkFn = checks[service as keyof typeof checks];
  if (!checkFn) {
    res.status(404).json({
      status: 'not_found',
      timestamp: new Date().toISOString(),
      error: `Unknown service: ${service}`,
    });
    return;
  }

  try {
    const result = await checkFn();
    const httpStatus = result.status === 'unhealthy' ? 503 : 200;
    res.status(httpStatus).json({
      service,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      service,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Prometheus metrics endpoint
 */
export async function handleMetrics(req: Request, res: Response): Promise<void> {
  try {
    // Ensure metrics are initialized
    initializeMetrics();
    const metrics = await getMetricsAsText();
    res.set('Content-Type', getMetricsContentType());
    res.send(metrics);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate metrics',
    });
  }
}

/**
 * Metrics JSON endpoint (for debugging)
 */
export async function handleMetricsJSON(req: Request, res: Response): Promise<void> {
  try {
    initializeMetrics();
    const metrics = await import('../shared/metrics.js').then(m => m.getMetricsAsJSON());
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate metrics JSON',
    });
  }
}