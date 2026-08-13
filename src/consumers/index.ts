/**
 * Phase 7 Consumers - Redis Stream Consumers
 * Exports all consumer classes for Phase 7 Observability & Audit
 */

export { BaseConsumer, ConsumerOptions, ConsumerStats } from './baseConsumer.js';
export { MetricsAggregatorConsumer, MetricsAggregatorOptions } from './metricsAggregator.js';
export { AlertEvaluatorConsumer, AlertEvaluatorOptions, AlertRule, Alert } from './alertEvaluator.js';
export { AuditArchiverConsumer, AuditArchiverOptions } from './auditArchiver.js';
export { DashboardUpdaterConsumer, DashboardUpdaterOptions, MaterializedView } from './dashboardUpdater.js';
export { CommandHandlerConsumer, CommandHandlerOptions, createCommandHandlerConsumer } from './commandHandler.js';
export { ConsumerManager, ConsumerManagerOptions, ConsumerHealth, createConsumerManager } from './consumerManager.js';