/**
 * Main application entry point
 * Initializes HTTP server, Redis stream consumers, and the webhook watchdog
 */

import { startHttpServer } from './server.js';
import { initializeEventBus } from './shared/events.js';
import { createConsumerManager } from './consumers/index.js';
import { runWatchdog } from './dispatch/webhookWatchdog.js';
import { config } from './shared/config.js';
import type { ConsumerManager } from './consumers/index.js';

let consumerManager: ConsumerManager | null = null;
let watchdogInterval: NodeJS.Timeout | null = null;

/**
 * Start the webhook watchdog polling loop.
 * Polls providers (adapter.checkStatus) for shots stuck in 'dispatched'/'generating'
 * when no public webhook URL is reachable.
 */
function startWatchdogLoop(): void {
  const pollMs = config.dispatch?.watchdogPollIntervalMs || 30000;
  watchdogInterval = setInterval(() => {
    runWatchdog().catch((err: Error) => {
      console.error('Watchdog cycle error:', err);
    });
  }, pollMs);
  console.log(`✅ Webhook watchdog started (poll interval ${pollMs}ms)`);
}

async function main() {
  console.log('[Main] Starting...');
  console.log('🚀 Starting AI Video Production Specialist FTE...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  try {
    // Initialize Redis streams and consumer groups
    console.log('[Main] Calling initializeEventBus...');
    await initializeEventBus();
    console.log('[Main] initializeEventBus completed');

    // Start all Redis stream consumers (CommandHandlerConsumer dispatches shots
    // on 'approve' commands; observability consumers track events)
    consumerManager = createConsumerManager();
    await consumerManager.start();

    // Start watchdog to recover async completions via provider polling
    startWatchdogLoop();

    await startHttpServer();
    console.log('✅ AI Video FTE server ready');
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  console.log('Shutting down AI Video FTE...');
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (consumerManager) {
    await consumerManager.stop().catch((err) => {
      console.error('Error stopping consumers:', err);
    });
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
