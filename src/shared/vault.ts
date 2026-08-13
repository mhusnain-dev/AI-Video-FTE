/**
 * Vault Transit encryption for biometric data
 * Per-user DEK (AES-256-GCM) encrypted by Vault Transit KEK
 * 90-day automated key rotation with zero-downtime re-encryption
 * Implements NFR-006, EC-019, CON-004
 */

import * as crypto from 'crypto';
import vault from 'node-vault';
import { config } from './config.js';
import { vaultEncryptTotal, vaultDecryptTotal, vaultEncryptDurationSeconds, vaultDecryptDurationSeconds, vaultDEKRotationTotal, vaultKEKRotationTotal, vaultStatusGauge } from './metrics.js';

interface VaultClient {
  write(path: string, data: any): Promise<any>;
  read(path: string): Promise<any>;
  encryptData(args: { name: string; plaintext: string }): Promise<{ data: { ciphertext: string } }>;
  decryptData(args: { name: string; ciphertext: string }): Promise<{ data: { plaintext: string } }>;
}

let vaultClient: VaultClient | null = null;

export function getVaultClient(): VaultClient {
  if (!vaultClient) {
    const v = vault({
      endpoint: config.vault.address,
      token: config.vault.token,
    });
    vaultClient = v as unknown as VaultClient;
    vaultStatusGauge.set(1);
  }
  return vaultClient;
}

/**
 * Encryption envelope for biometric embeddings
 * Contains: version, key_id, iv, auth_tag, ciphertext
 */
export interface EncryptedEnvelope {
  version: number;
  keyId: string; // Vault key version or user DEK identifier
  iv: string; // Base64
  authTag: string; // Base64
  ciphertext: string; // Base64
  algorithm: 'aes-256-gcm';
}

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Generate a per-user Data Encryption Key (DEK)
 * Returns base64 encoded 32-byte key
 */
export function generateDEK(): string {
  return crypto.randomBytes(32).toString('base64');
}

async function measureVaultOperation<T>(operation: 'encrypt' | 'decrypt' | 'rewrap' | 'rotate', fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    if (operation === 'encrypt') vaultEncryptTotal.inc({ status: 'success' });
    if (operation === 'decrypt') vaultDecryptTotal.inc({ status: 'success' });
    if (operation === 'rewrap') vaultDEKRotationTotal.inc({ status: 'success' });
    if (operation === 'rotate') vaultKEKRotationTotal.inc({ status: 'success' });
    return result;
  } catch (error) {
    if (operation === 'encrypt') vaultEncryptTotal.inc({ status: 'error' });
    if (operation === 'decrypt') vaultDecryptTotal.inc({ status: 'error' });
    if (operation === 'rewrap') vaultDEKRotationTotal.inc({ status: 'error' });
    if (operation === 'rotate') vaultKEKRotationTotal.inc({ status: 'error' });
    throw error;
  } finally {
    const duration = Date.now() - start;
    if (operation === 'encrypt') vaultEncryptDurationSeconds.observe({}, duration / 1000);
    if (operation === 'decrypt') vaultDecryptDurationSeconds.observe({}, duration / 1000);
  }
}

/**
 * Encrypt a DEK using Vault Transit KEK
 * Returns Vault ciphertext (vault:v1:...)
 */
export async function encryptDEKWithKEK(dekBase64: string): Promise<string> {
  const client = getVaultClient();
  const result = await measureVaultOperation('encrypt', () =>
    client.encryptData({ name: config.vault.transitKeyName, plaintext: dekBase64 })
  );
  return result.data.ciphertext; // vault:v1:...
}

/**
 * Decrypt a DEK using Vault Transit KEK
 * Returns base64 encoded DEK
 */
export async function decryptDEKWithKEK(ciphertext: string): Promise<string> {
  const client = getVaultClient();
  const result = await measureVaultOperation('decrypt', () =>
    client.decryptData({ name: config.vault.transitKeyName, ciphertext })
  );
  // Vault returns base64 plaintext
  return result.data.plaintext;
}

/**
 * Encrypt biometric embedding (face/voice vector) with per-user DEK
 * Returns EncryptedEnvelope
 */
export function encryptEmbedding(embedding: number[], dekBase64: string): EncryptedEnvelope {
  const dek = Buffer.from(dekBase64, 'base64');
  const iv = crypto.randomBytes(IV_LENGTH);
  const plaintext = Buffer.from(JSON.stringify(embedding));

  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: ENVELOPE_VERSION,
    keyId: 'user-dek', // Logical identifier; actual DEK encrypted by KEK
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypt biometric embedding from envelope using per-user DEK
 */
export function decryptEmbedding(envelope: EncryptedEnvelope, dekBase64: string): number[] {
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: ${envelope.version}`);
  }
  if (envelope.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${envelope.algorithm}`);
  }

  const dek = Buffer.from(dekBase64, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * High-level: Encrypt embedding for storage
 * 1. Get or generate user's DEK
 * 2. Encrypt embedding with DEK
 * 3. Encrypt DEK with Vault KEK
 * 4. Store both envelope and encrypted DEK
 */
export interface StoredEncryptedEmbedding {
  envelope: EncryptedEnvelope;
  encryptedDek: string; // Vault ciphertext
}

export async function encryptEmbeddingForStorage(
  embedding: number[],
  userId: string,
  getUserDek: (userId: string) => Promise<{ dekBase64: string; encryptedDek: string } | null>,
  storeUserDek: (userId: string, dekBase64: string, encryptedDek: string) => Promise<void>
): Promise<StoredEncryptedEmbedding> {
  // Get or generate user's DEK
  let userDek = await getUserDek(userId);
  if (!userDek) {
    const dekBase64 = generateDEK();
    const encryptedDek = await encryptDEKWithKEK(dekBase64);
    await storeUserDek(userId, dekBase64, encryptedDek);
    userDek = { dekBase64, encryptedDek };
  }

  const envelope = encryptEmbedding(embedding, userDek.dekBase64);
  return { envelope, encryptedDek: userDek.encryptedDek };
}

/**
 * High-level: Decrypt embedding from storage
 */
export async function decryptEmbeddingFromStorage(
  stored: StoredEncryptedEmbedding,
  userId: string,
  getUserDek: (userId: string) => Promise<{ dekBase64: string; encryptedDek: string } | null>
): Promise<number[]> {
  const userDek = await getUserDek(userId);
  if (!userDek) {
    throw new Error(`No DEK found for user ${userId}`);
  }
  return decryptEmbedding(stored.envelope, userDek.dekBase64);
}

/**
 * Key rotation: Rewrap DEK with new KEK version
 * Called during 90-day rotation (EC-019)
 * Zero-downtime: new writes use new KEK, existing reads work with old KEK via rewrap
 */
export async function rotateUserDek(
  userId: string,
  getUserDek: (userId: string) => Promise<{ dekBase64: string; encryptedDek: string } | null>,
  updateUserDek: (userId: string, newEncryptedDek: string) => Promise<void>
): Promise<void> {
  const userDek = await getUserDek(userId);
  if (!userDek) {
    throw new Error(`No DEK found for user ${userId} to rotate`);
  }

  // Rewrap DEK with latest KEK version
  const client = getVaultClient();
  const result = await measureVaultOperation('rewrap', () =>
    client.write(`transit/rewrap/${config.vault.transitKeyName}`, { ciphertext: userDek.encryptedDek })
  );
  const newEncryptedDek = result.data.ciphertext;

  await updateUserDek(userId, newEncryptedDek);
  console.log(`Rotated DEK for user ${userId}`);
}

/**
 * Background job: Rotate all user DEKs
 * Runs every 90 days (config.vault.rotationIntervalDays)
 */
export async function rotateAllUserDeks(
  getAllUserIds: () => Promise<string[]>,
  getUserDek: (userId: string) => Promise<{ dekBase64: string; encryptedDek: string } | null>,
  updateUserDek: (userId: string, newEncryptedDek: string) => Promise<void>
): Promise<{ rotated: number; failed: number }> {
  const userIds = await getAllUserIds();
  let rotated = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await rotateUserDek(userId, getUserDek, updateUserDek);
      rotated++;
    } catch (error) {
      console.error(`Failed to rotate DEK for user ${userId}:`, error);
      failed++;
    }
  }

  return { rotated, failed };
}

/**
 * Vault key rotation: Rotate the KEK itself
 * This creates a new key version in Vault Transit
 * Old versions remain decryptable; new encrypts use latest
 */
export async function rotateVaultTransitKey(): Promise<void> {
  const client = getVaultClient();
  await measureVaultOperation('rotate', () =>
    client.write(`transit/keys/${config.vault.transitKeyName}/rotate`, {})
  );
  console.log(`Rotated Vault Transit key: ${config.vault.transitKeyName}`);
}

/**
 * Initialize Vault Transit key if not exists
 */
export async function initializeVaultKey(): Promise<void> {
  const client = getVaultClient();
  try {
    await client.read(`transit/keys/${config.vault.transitKeyName}`);
    console.log(`Vault Transit key ${config.vault.transitKeyName} already exists`);
  } catch {
    await client.write(`transit/keys/${config.vault.transitKeyName}`, {
      type: 'aes256-gcm96',
      derivation: 'raw',
      exportable: false,
      allow_plaintext_backup: false,
    });
    console.log(`Created Vault Transit key ${config.vault.transitKeyName}`);
  }
}