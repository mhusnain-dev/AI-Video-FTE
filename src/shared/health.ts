/**
 * Health Check Registry
 * Provides centralized health checking for all FTE components
 * Implements FR-034, NFR-001, AC-029
 */

import { HealthStatus, ComponentHealth } from './types.js';

export type HealthCheckFn = () => Promise<ComponentHealth>;

export interface HealthCheckRegistration {
  name: string;
  check: HealthCheckFn;
  critical: boolean; // If true, failure makes overall status unhealthy
}

export interface HealthConfig {
  livenessThresholdMs: number;
  readinessThresholdMs: number;
}

export class HealthCheckRegistry {
  private checks: Map<string, HealthCheckRegistration> = new Map();
  private config: HealthConfig;

  constructor(config?: Partial<HealthConfig>) {
    this.config = {
      livenessThresholdMs: config?.livenessThresholdMs || 15000,
      readinessThresholdMs: config?.readinessThresholdMs || 10000,
    };
  }

  /**
   * Register a health check
   */
  register(name: string, check: HealthCheckFn, critical = false): void {
    this.checks.set(name, { name, check, critical });
  }

  /**
   * Unregister a health check
   */
  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  /**
   * Run all registered health checks
   */
  async runAll(): Promise<Record<string, ComponentHealth>> {
    const results: Record<string, ComponentHealth> = {};

    for (const [name, registration] of this.checks) {
      try {
        const result = await Promise.race([
          registration.check(),
          new Promise<ComponentHealth>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Health check ${name} timed out`)),
              this.config.readinessThresholdMs
            )
          ),
        ]);
        results[name] = result;
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          latencyMs: undefined,
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    }

    return results;
  }

  /**
   * Run only critical health checks (for liveness)
   */
  async runCritical(): Promise<Record<string, ComponentHealth>> {
    const results: Record<string, ComponentHealth> = {};

    for (const [name, registration] of this.checks) {
      if (!registration.critical) continue;

      try {
        const result = await Promise.race([
          registration.check(),
          new Promise<ComponentHealth>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Health check ${name} timed out`)),
              this.config.livenessThresholdMs
            )
          ),
        ]);
        results[name] = result;
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          latencyMs: undefined,
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    }

    return results;
  }

  /**
   * Get list of registered check names
   */
  getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  /**
   * Check if a specific check is registered
   */
  hasCheck(name: string): boolean {
    return this.checks.has(name);
  }
}

/**
 * Singleton health check registry
 */
let healthRegistry: HealthCheckRegistry | null = null;

export function getHealthRegistry(): HealthCheckRegistry {
  if (!healthRegistry) {
    healthRegistry = new HealthCheckRegistry();
  }
  return healthRegistry;
}

export function setHealthRegistry(registry: HealthCheckRegistry): void {
  healthRegistry = registry;
}

/**
 * Compute overall health status from component checks
 */
export function computeOverallHealth(
  checks: Record<string, ComponentHealth>,
  criticalCheckNames: string[] = []
): HealthStatus['status'] {
  if (Object.keys(checks).length === 0) {
    return 'healthy';
  }

  // If any critical check is unhealthy, overall is unhealthy
  for (const name of criticalCheckNames) {
    const check = checks[name];
    if (check && check.status === 'unhealthy') {
      return 'unhealthy';
    }
  }

  // If any check is unhealthy (non-critical), overall is degraded
  for (const check of Object.values(checks)) {
    if (check.status === 'unhealthy') {
      return 'degraded';
    }
  }

  // If any check is degraded, overall is degraded
  for (const check of Object.values(checks)) {
    if (check.status === 'degraded') {
      return 'degraded';
    }
  }

  return 'healthy';
}

/**
 * Build HealthStatus object from check results
 */
export function buildHealthStatus(
  checks: Record<string, ComponentHealth>,
  metrics: HealthStatus['metrics'],
  criticalCheckNames: string[] = []
): HealthStatus {
  const status = computeOverallHealth(checks, criticalCheckNames);

  return {
    status,
    timestamp: new Date(),
    metrics,
    checks,
  };
}

/**
 * Default metrics collector (to be replaced by actual metrics)
 */
export async function getDefaultMetrics(): Promise<HealthStatus['metrics']> {
  return {
    processingBacklog: 0,
    avgLatencyMs: 0,
    errorRate: 0,
    costDriftPercentage: 0,
    activeStories: 0,
    activeShots: 0,
  };
}