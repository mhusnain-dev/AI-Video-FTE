/**
 * Phase 7 Consumers - Redis Stream Consumers
 * Exports all consumer classes for Phase 7 Observability & Audit
 */

export { BaseConsumer } from './baseConsumer.js';
export type { ConsumerOptions, ConsumerStats } from './baseConsumer.js';
export { MetricsAggregatorConsumer } from './metricsAggregator.js';
export type { MetricsAggregatorOptions } from './metricsAggregator.js';
export { AlertEvaluatorConsumer } from './alertEvaluator.js';
export type { AlertEvaluatorOptions, AlertRule, Alert } from './alertEvaluator.js';
export { AuditArchiverConsumer } from './auditArchiver.js';
export type { AuditArchiverOptions } from './auditArchiver.js';
export { DashboardUpdaterConsumer } from './dashboardUpdater.js';
export type { DashboardUpdaterOptions, MaterializedView } from './dashboardUpdater.js';
export { CommandHandlerConsumer, createCommandHandlerConsumer } from './commandHandler.js';
export type { CommandHandlerOptions } from './commandHandler.js';
export { ConsumerManager, createConsumerManager } from './consumerManager.js';
export type { ConsumerManagerOptions, ConsumerHealth } from './consumerManager.js';