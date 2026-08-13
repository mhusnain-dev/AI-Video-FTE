/**
 * Main application entry point
 * Initializes HTTP server with all routes
 */

import { startHttpServer } from './server.js';

async function main() {
  console.log('🚀 Starting AI Video Production Specialist FTE...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  try {
    await startHttpServer();
    console.log('✅ AI Video FTE server ready');
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
}

main();