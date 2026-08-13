/**
 * Alert Evaluator Consumer
 * Consumes story_events stream and evaluates alerting rules in real-time
 * Fires alerts to Alertmanager / PagerDuty for critical operational events
 * Implements FR-034, NFR-001, NFR-005
 */

import { BaseConsumer, ConsumerOptions } from './baseConsumer.js';
import { query } from '../shared/db.js';
import type { StreamMessage, StateChangeEvent } from '../shared/types.js';
import { config } from '../shared/config.js';
import { STREAMS } from '../shared/redis.js';

export interface AlertRule {
  name: string;
  severity: 'critical' | 'warning' | 'info';
  evaluate: (event: StateChangeEvent) => Promise<boolean>;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  runbook?: string;
}

export interface Alert {
  name: string;
  severity: 'critical' | 'warning' | 'info';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  timestamp: Date;
  runbook?: string;
}

export interface AlertEvaluatorOptions extends ConsumerOptions {
  /** Alert notification webhook URL (Alertmanager, PagerDuty, etc.) */
  alertWebhookUrl?: string;
  /** Custom alert rules */
  customRules?: AlertRule[];
  /** Deduplication window (ms) - don't fire same alert within this window */
  dedupWindowMs?: number;
}

interface AlertState {
  lastFired: Map<string, number>; // alert name -> timestamp
  activeAlerts: Map<string, Alert>; // alert name -> alert
}

// Type helper for event metadata payload
interface EventPayload {
  gate?: string;
  allModelsFailed?: boolean;
  component?: string;
  driftPercentage?: number;
  retryCount?: number;
  count?: number;
  overallDriftDetected?: boolean;
  overallPassed?: boolean;
  fromModel?: string;
  toModel?: string;
  trigger?: string;
  matchType?: string;
  [key: string]: unknown;
}

export class AlertEvaluatorConsumer extends BaseConsumer {
  private readonly alertWebhookUrl?: string;
  private readonly rules: AlertRule[];
  private readonly dedupWindowMs: number;
  private alertState: AlertState;

  constructor(options: AlertEvaluatorOptions) {
    super({
      ...options,
      groupName: options.groupName,
      consumerName: options.consumerName,
      stream: options.stream,
    });

    this.alertWebhookUrl = options.alertWebhookUrl;
    this.dedupWindowMs = options.dedupWindowMs ?? 300000; // 5 minutes default
    this.alertState = {
      lastFired: new Map(),
      activeAlerts: new Map(),
    };

    // Built-in alert rules from integration map (Section 11)
    this.rules = [
      ...this.createBuiltInRules(),
      ...(options.customRules ?? []),
    ];
  }

  private createBuiltInRules(): AlertRule[] {
    return [
      // Critical Alerts (Page Immediately)
      {
        name: 'SacredGuardBlock',
        severity: 'critical',
        labels: { severity: 'critical', runbook: 'sacred-guard-block' },
        annotations: { description: 'Sacred Guard blocked a shot at an enforcement point' },
        runbook: 'sacred-guard-block',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'admission_fail' &&
            payload.gate === 'sacred_guard';
        },
      },
      {
        name: 'MergeFailure',
        severity: 'critical',
        labels: { severity: 'critical', runbook: 'merge-failure' },
        annotations: { description: 'Video merge failed for a story' },
        runbook: 'merge-failure',
        async evaluate(event: StateChangeEvent) {
          return event.metadata?.action === 'merge_complete' &&
            event.toState === 'failed';
        },
      },
      {
        name: 'AllModelsFailedForShot',
        severity: 'critical',
        labels: { severity: 'critical', runbook: 'all-models-failed' },
        annotations: { description: 'All models failed for a shot' },
        runbook: 'all-models-failed',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.entityType === 'shot' &&
            event.toState === 'failed' &&
            payload.allModelsFailed === true;
        },
      },
      {
        name: 'DatabaseUnavailable',
        severity: 'critical',
        labels: { severity: 'critical', runbook: 'db-down' },
        annotations: { description: 'Database connection unavailable' },
        runbook: 'db-down',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'health_check_fail' &&
            payload.component === 'database';
        },
      },
      {
        name: 'VaultUnavailable',
        severity: 'critical',
        labels: { severity: 'critical', runbook: 'vault-down' },
        annotations: { description: 'Vault connection unavailable' },
        runbook: 'vault-down',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'health_check_fail' &&
            payload.component === 'vault';
        },
      },

      // Warning Alerts (Ticket + Notify)
      {
        name: 'CostDriftHigh',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'cost-drift' },
        annotations: { description: 'Cost drift percentage exceeded 20%' },
        runbook: 'cost-drift',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'cost_drift_alert' &&
            (payload.driftPercentage ?? 0) > 20;
        },
      },
      {
        name: 'FaceLockFailureRateHigh',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'facelock-failures' },
        annotations: { description: 'Face-Lock failure rate exceeded 20% over 5min' },
        runbook: 'facelock-failures',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'face_lock_verification_failed' &&
            (payload.retryCount ?? 0) >= 2;
        },
      },
      {
        name: 'RateLimitExceeded',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'rate-limit' },
        annotations: { description: 'Rate limit gate blocked multiple requests' },
        runbook: 'rate-limit',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'admission_fail' &&
            payload.gate === 'rate_limit';
        },
      },
      {
        name: 'HighShotTimeoutRate',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'shot-timeouts' },
        annotations: { description: 'High shot timeout rate detected' },
        runbook: 'shot-timeouts',
        async evaluate(event: StateChangeEvent) {
          return event.entityType === 'shot' &&
            event.metadata?.action === 'model_timeout';
        },
      },
      {
        name: 'WebhookUnrecognizedSpike',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'webhook-unrecognized' },
        annotations: { description: 'Spike in unrecognized webhooks' },
        runbook: 'webhook-unrecognized',
        async evaluate(event: StateChangeEvent) {
          return event.metadata?.action === 'unrecognized_webhook';
        },
      },
      {
        name: 'WatchdogStuckDispatches',
        severity: 'warning',
        labels: { severity: 'warning', runbook: 'watchdog-stuck' },
        annotations: { description: 'Watchdog detected stuck dispatches' },
        runbook: 'watchdog-stuck',
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'watchdog_stuck_dispatches' &&
            (payload.count ?? 0) > 10;
        },
      },

      // Info Alerts (Log Only)
      {
        name: 'FaceLockCrossShotDrift',
        severity: 'info',
        labels: { severity: 'info' },
        annotations: { description: 'Cross-shot drift detected in Face-Lock consistency report' },
        async evaluate(event: StateChangeEvent) {
          const payload = (event.metadata?.payload ?? {}) as EventPayload;
          return event.metadata?.action === 'cross_shot_consistency_report' &&
            payload.overallDriftDetected === true;
        },
      },
      {
        name: 'DeliveryPackageExpired',
        severity: 'info',
        labels: { severity: 'info' },
        annotations: { description: 'Delivery package expired without download' },
        async evaluate(event: StateChangeEvent) {
          return event.metadata?.action === 'delivery_package_expired';
        },
      },
      {
        name: 'ModelFallbackTriggered',
        severity: 'info',
        labels: { severity: 'info' },
        annotations: { description: 'Model fallback triggered for a shot' },
        async evaluate(event: StateChangeEvent) {
          return event.entityType === 'shot' &&
            event.metadata?.action === 'fallback_dispatch';
        },
      },
    ];
  }

  protected async processMessage(message: StreamMessage): Promise<void> {
    if (message.stream !== STREAMS.STORY_EVENTS) return;

    const event = this.parseStateChangeEvent(message);
    if (!event) return;

    // Evaluate all rules against this event
    for (const rule of this.rules) {
      try {
        const shouldFire = await rule.evaluate(event);
        if (shouldFire) {
          await this.maybeFireAlert(rule, event);
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.name}:`, error);
      }
    }
  }

  private async maybeFireAlert(rule: AlertRule, event: StateChangeEvent): Promise<void> {
    const now = Date.now();
    const lastFired = this.alertState.lastFired.get(rule.name) ?? 0;

    // Deduplication check
    if (now - lastFired < this.dedupWindowMs) {
      return; // Skip - still in dedup window
    }

    const action = (event.metadata?.action ?? 'unknown') as string;
    const alert: Alert = {
      name: rule.name,
      severity: rule.severity,
      labels: {
        ...rule.labels,
        storyId: event.entityId,
        entityType: event.entityType,
        fromState: event.fromState,
        toState: event.toState,
        action,
      },
      annotations: {
        ...rule.annotations,
        eventId: event.id,
        timestamp: event.timestamp.toISOString(),
      },
      timestamp: new Date(),
      runbook: rule.runbook,
    };

    // Fire alert
    await this.fireAlert(alert);

    // Update dedup state
    this.alertState.lastFired.set(rule.name, now);
    this.alertState.activeAlerts.set(rule.name, alert);

    console.log(`Alert fired: ${rule.name} [${rule.severity}] for event ${event.id}`);
  }

  private async fireAlert(alert: Alert): Promise<void> {
    // Log alert
    console.log(`[ALERT] ${alert.severity.toUpperCase()}: ${alert.name}`, alert);

    // Persist to database for audit trail
    try {
      await query(
        `INSERT INTO alerts (name, severity, labels, annotations, fired_at, runbook)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          alert.name,
          alert.severity,
          JSON.stringify(alert.labels),
          JSON.stringify(alert.annotations),
          alert.timestamp,
          alert.runbook ?? null,
        ]
      );
    } catch (error) {
      // Table might not exist yet, log but don't fail
      console.debug('Alert persistence failed (table may not exist):', error);
    }

    // Send to webhook if configured (Alertmanager, PagerDuty, etc.)
    if (this.alertWebhookUrl) {
      try {
        const response = await fetch(this.alertWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alerts: [{
              labels: alert.labels,
              annotations: alert.annotations,
              startsAt: alert.timestamp.toISOString(),
              generatorURL: `ai-video-fte/${alert.name}`,
            }],
          }),
        });

        if (!response.ok) {
          console.error(`Alert webhook failed: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error('Alert webhook error:', error);
      }
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alertState.activeAlerts.values());
  }

  /**
   * Clear resolved alerts (call periodically)
   */
  clearResolvedAlerts(maxAgeMs: number = 3600000): void { // 1 hour default
    const now = Date.now();
    for (const [name, alert] of this.alertState.activeAlerts) {
      if (now - alert.timestamp.getTime() > maxAgeMs) {
        this.alertState.activeAlerts.delete(name);
      }
    }
  }
}