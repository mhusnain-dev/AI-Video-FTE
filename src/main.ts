/**
 * Main application entry point
 * Initializes HTTP server, Redis stream consumers, and the webhook watchdog
 */

import { startHttpServer } from './server.js';
import { initializeEventBus } from './shared/events.js';
import { createConsumerManager } from './consumers/index.js';
import { runWatchdog } from './dispatch/webhookWatchdog.js';
import { initializeVaultKey } from './shared/vault.js';
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

  // Run immediately on startup (not delayed by one interval)
  runWatchdog().then((result) => {
    if (result.errors.length > 0) {
      console.error('[Watchdog] Initial cycle errors:', result.errors);
    }
    if (result.recovered > 0) {
      console.log(`[Watchdog] Initial cycle: recovered ${result.recovered} dispatch(es)`);
    }
  }).catch((err: Error) => {
    console.error('[Watchdog] Initial cycle error:', err);
  });

  watchdogInterval = setInterval(() => {
    runWatchdog().then((result) => {
      if (result.errors.length > 0) {
        console.error('[Watchdog] Cycle errors:', result.errors);
      }
      if (result.recovered > 0 || result.timedOut > 0) {
        console.log(`[Watchdog] Cycle result: recovered=${result.recovered}, timedOut=${result.timedOut}, failed=${result.failed}`);
      }
    }).catch((err: Error) => {
      console.error('[Watchdog] Cycle error:', err);
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

    // Initialize Vault transit engine + key (idempotent, safe on restart)
    try {
      await initializeVaultKey();
      console.log('[Main] Vault transit initialized');
    } catch (err) {
      console.warn('[Main] Vault transit init failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    // Start all Redis stream consumers (CommandHandlerConsumer dispatches shots
    // on 'approve' commands; observability consumers track events)
    consumerManager = createConsumerManager({ auditArchiver: false });
    await consumerManager.start();

    // Start watchdog to recover async completions via provider polling
    startWatchdogLoop();

    await startHttpServer();
    console.log('✅ AI Video FTE server ready');

    // Keep process alive
    setInterval(() => {}, 1000 * 60 * 60);
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
}

async function shutdown(signal?: string): Promise<void> {
  console.log(`Shutting down AI Video FTE... ${signal ? `Signal: ${signal}` : ''}`);
  console.trace('Shutdown stack trace:');
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

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('SIGUSR1', () => shutdown('SIGUSR1'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));

main();
