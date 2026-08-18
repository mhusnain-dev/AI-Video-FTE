#!/usr/bin/env node
/**
 * Wait for services to be ready before starting API
 * Used by npm run dev:api
 */

import net from 'net';

const services = [
  { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '5433'), name: 'PostgreSQL' },
  { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6380'), name: 'Redis' },
  { host: process.env.VAULT_ADDR?.replace('http://', '').replace('https://', '').split(':')[0] || 'localhost', port: parseInt(process.env.VAULT_ADDR?.split(':')[2] || '8201'), name: 'Vault' },
];

function checkPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function waitForService(service: { host: string; port: number; name: string }, maxAttempts = 60): Promise<void> {
  console.log(`[Wait] Waiting for ${service.name} at ${service.host}:${service.port}...`);
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await checkPort(service.host, service.port);
    if (ready) {
      console.log(`[Wait] ${service.name} ready!`);
      return;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`${service.name} at ${service.host}:${service.port} not ready after ${maxAttempts * 2}s`);
}

async function initVault(): Promise<void> {
  const vaultAddr = process.env.VAULT_ADDR || 'http://localhost:8201';
  const vaultToken = process.env.VAULT_TOKEN || 'root';
  const transitKey = process.env.VAULT_TRANSIT_KEY || 'biometric-encryption-dev';

  try {
    const enableRes = await fetch(`${vaultAddr}/v1/sys/mounts/transit`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    if (!enableRes.ok) {
      const enableBody = { type: 'transit', options: {} };
      await fetch(`${vaultAddr}/v1/sys/mounts/transit`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(enableBody),
      });
      console.log('[Wait] Enabled Vault transit engine');
    }

    const keyRes = await fetch(`${vaultAddr}/v1/transit/keys/${transitKey}`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    if (!keyRes.ok) {
      await fetch(`${vaultAddr}/v1/transit/keys/${transitKey}`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      console.log(`[Wait] Created Vault transit key: ${transitKey}`);
    }

    console.log('[Wait] Vault initialized');
  } catch (err: any) {
    console.warn(`[Wait] Vault init failed (non-fatal): ${err.message}`);
  }
}

async function main() {
  console.log('[Wait] Checking required services...');
  await Promise.all(services.map(s => waitForService(s)));
  await initVault();
  console.log('[Wait] All services ready, starting API...');
}

main().catch(err => {
  console.error('[Wait] Failed:', err.message);
  process.exit(1);
});