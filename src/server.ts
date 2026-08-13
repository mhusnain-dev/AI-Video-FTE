/**
 * HTTP Server Setup
 * Mounts all API routes and starts the Express server
 */

import express, { Request, Response, NextFunction } from 'express';
import { config } from './shared/config.js';
import { closePool } from './shared/db.js';
import { closeRedis } from './shared/redis.js';
import { closeEventBus } from './shared/events.js';
import { initializeMetrics } from './shared/metrics.js';
import { registerHealthChecks } from './routes/health.js';
import {
  handleHealth,
  handleHealthLive,
  handleHealthReady,
  handleHealthStartup,
  handleServiceHealth,
  handleMetrics,
  handleMetricsJSON,
} from './routes/health.js';

// Import existing routes
import ingestionRoutes from './ingestion/routes.js';
import admissionRoutes from './admission/routes.js';
import routerRoutes from './router/routes.js';
import dispatchRoutes from './dispatch/routes.js';
import mergerRoutes from './merger/routes.js';
import userPriorityRoutes from './router/userPriorityRoutes.js';
import { handleStoryStream } from './routes/events.js';

const app = express();

app.use(express.json({ limit: '10mb' }));

// ============================================================================
// Health & Metrics Endpoints
// ============================================================================

// Kubernetes probes
app.get('/health/live', handleHealthLive);
app.get('/health/ready', handleHealthReady);
app.get('/health/startup', handleHealthStartup);

// Aggregate health
app.get('/health', handleHealth);

// Service-specific health
app.get('/health/:service', handleServiceHealth);

// Prometheus metrics
app.get('/metrics', handleMetrics);
app.get('/metrics/json', handleMetricsJSON);

// ============================================================================
// API Routes
// ============================================================================

app.use('/stories', ingestionRoutes);
app.use('/api/stories', ingestionRoutes);
app.use('/admission', admissionRoutes);
app.use('/router', routerRoutes);
app.use('/dispatch', dispatchRoutes);
app.use('/merger', mergerRoutes);

// Model Priority compatibility alias for frontend (/api/users/.../model-priority)
// Reuses existing modelRegistry business logic via userPriorityRoutes
app.use('/api', userPriorityRoutes);

// SSE Events
app.get('/api/stories/:id/stream', handleStoryStream);

// ============================================================================
// Error Handling
// ============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================================
// Server Startup
// ============================================================================

let httpServer: ReturnType<typeof app.listen> | null = null;
let metricsServer: ReturnType<typeof app.listen> | null = null;

export async function startHttpServer(): Promise<void> {
  // Register health checks
  registerHealthChecks();

  // Initialize metrics
  initializeMetrics();

  // Main HTTP server (API)
  const apiPort = process.env.API_PORT ? parseInt(process.env.API_PORT) : 3000;
  httpServer = app.listen(apiPort, () => {
    console.log(`✅ API server listening on port ${apiPort}`);
  });

  // Metrics server (Prometheus) on separate port
  const metricsPort = config.observability.metricsPort;
  // Create a minimal app for metrics only
  const metricsApp = express();
  metricsApp.get('/metrics', handleMetrics);
  metricsApp.get('/health/live', handleHealthLive);
  metricsApp.get('/health/ready', handleHealthReady);
  metricsApp.get('/health', handleHealth);

  metricsServer = metricsApp.listen(metricsPort, () => {
    console.log(`📊 Metrics server listening on port ${metricsPort}`);
  });
}

export async function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => {
        console.log('API server closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export async function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (metricsServer) {
      metricsServer.close(() => {
        console.log('Metrics server closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export async function gracefulShutdown(): Promise<void> {
  console.log('Shutting down gracefully...');

  // Stop accepting new connections
  await stopHttpServer();
  await stopMetricsServer();

  // Close infrastructure connections
  await closePool();
  await closeRedis();
  await closeEventBus();

  console.log('Graceful shutdown complete');
  process.exit(0);
}

// Handle signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export { app };