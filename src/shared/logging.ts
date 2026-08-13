/**
 * Structured Logging with Pino
 * Implements FR-034, NFR-001, NFR-004
 * Provides structured JSON logs with trace context propagation
 */

import { pino, type Logger, type LoggerOptions } from 'pino';
import { config } from './config.js';

// Custom log levels
const customLevels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

// Extended logger type with custom methods
export interface ExtendedLogger extends Logger {
  audit: (meta: Record<string, unknown>, message: string) => void;
  security: (meta: Record<string, unknown>, message: string) => void;
  performance: (meta: Record<string, unknown>, message: string) => void;
  traceContext: (traceId: string, spanId: string, parentSpanId?: string) => ExtendedLogger;
}

// Pretty printer for development
const prettyTransport: pino.TransportTargetOptions = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  },
};

let loggerInstance: ExtendedLogger | null = null;

/**
 * Get or create the Pino logger singleton
 */
export function getLogger(): ExtendedLogger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

/**
 * Create a new logger instance with current configuration
 */
export function createLogger(options?: Partial<LoggerOptions>): ExtendedLogger {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const logLevel = config.observability?.logging?.level || (isDevelopment ? 'debug' : 'info');

  const loggerOptions: LoggerOptions = {
    level: logLevel,
    customLevels,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    base: {
      service: 'ai-video-fte',
      version: process.env.npm_package_version || '0.1.0',
      environment: process.env.NODE_ENV || 'development',
    },
    mixin() {
      return {
        traceId: getCurrentTraceId(),
        spanId: getCurrentSpanId(),
      };
    },
    ...options,
  };

  if (isDevelopment) {
    loggerOptions.transport = prettyTransport;
  }

  const baseLogger = pino(loggerOptions) as ExtendedLogger;

  // Add convenience methods for common log patterns
  baseLogger.audit = function (meta: Record<string, unknown>, message: string): void {
    this.info({ ...meta, audit: true }, message);
  };

  baseLogger.security = function (meta: Record<string, unknown>, message: string): void {
    this.warn({ ...meta, security: true }, message);
  };

  baseLogger.performance = function (meta: Record<string, unknown>, message: string): void {
    this.debug({ ...meta, performance: true }, message);
  };

  baseLogger.traceContext = function (traceId: string, spanId: string, parentSpanId?: string): ExtendedLogger {
    setCurrentTraceContext(traceId, spanId, parentSpanId);
    return this;
  };

  return baseLogger;
}

/**
 * Initialize logging at application startup
 */
export function initializeLogging(): ExtendedLogger {
  return createLogger();
}

/**
 * Reset logger instance (for testing)
 */
export function resetLogger(): void {
  if (loggerInstance) {
    loggerInstance.flush();
    loggerInstance = null;
  }
  clearTraceContext();
}

// ============================================================================
// Trace Context Management
// ============================================================================

// Using AsyncLocalStorage for trace context propagation
import { AsyncLocalStorage } from 'async_hooks';

interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Get current trace context from async local storage
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

/**
 * Get current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  return traceContextStorage.getStore()?.traceId;
}

/**
 * Get current span ID
 */
export function getCurrentSpanId(): string | undefined {
  return traceContextStorage.getStore()?.spanId;
}

/**
 * Set current trace context
 */
export function setCurrentTraceContext(traceId: string, spanId: string, parentSpanId?: string): void {
  const context: TraceContext = { traceId, spanId, parentSpanId };
  traceContextStorage.enterWith(context);
}

/**
 * Clear current trace context
 */
export function clearTraceContext(): void {
  traceContextStorage.disable();
}

/**
 * Run a function with a specific trace context
 */
export function withTraceContext<T>(traceId: string, spanId: string, fn: () => T, parentSpanId?: string): T {
  const context: TraceContext = { traceId, spanId, parentSpanId };
  return traceContextStorage.run(context, fn);
}

/**
 * Create a child span with new span ID
 */
export function withChildSpan<T>(spanId: string, fn: () => T): T {
  const parentContext = traceContextStorage.getStore();
  if (!parentContext) {
    return fn();
  }
  const context: TraceContext = {
    traceId: parentContext.traceId,
    spanId,
    parentSpanId: parentContext.spanId,
  };
  return traceContextStorage.run(context, fn);
}

// ============================================================================
// Structured Log Helpers
// ============================================================================

/**
 * Log with structured metadata for audit trail
 */
export function logAudit(logger: ExtendedLogger, event: string, data: Record<string, unknown>): void {
  logger.audit({
    event,
    ...data,
  }, `AUDIT: ${event}`);
}

/**
 * Log security events
 */
export function logSecurity(logger: ExtendedLogger, event: string, data: Record<string, unknown>): void {
  logger.security({
    event,
    ...data,
  }, `SECURITY: ${event}`);
}

/**
 * Log performance metrics
 */
export function logPerformance(logger: ExtendedLogger, operation: string, durationMs: number, data: Record<string, unknown> = {}): void {
  logger.performance({
    operation,
    durationMs,
    ...data,
  }, `PERF: ${operation} took ${durationMs}ms`);
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(parent: ExtendedLogger, bindings: Record<string, unknown>): ExtendedLogger {
  return parent.child(bindings) as ExtendedLogger;
}

/**
 * Get the default logger (convenience export)
 */
export const logger = getLogger();

export default logger;