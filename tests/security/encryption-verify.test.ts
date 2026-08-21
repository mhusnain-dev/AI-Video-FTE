/**
 * Encryption at-rest Verification Tests (Task K6)
 * Tests Vault Transit encrypt/decrypt roundtrip, ciphertext non-readability,
 * different DEKs produce different ciphertexts, and biometric embedding encryption.
 *
 * Requires: Vault dev mode running (docker-compose.dev.yaml)
 */

import {
  generateDEK,
  encryptDEKWithKEK,
  decryptDEKWithKEK,
  encryptEmbedding,
  decryptEmbedding,
  encryptEmbeddingForStorage,
  decryptEmbeddingFromStorage,
  initializeVaultKey,
  type EncryptedEnvelope,
} from '../../src/shared/vault.js';

describe('Encryption at-rest verification', () => {
  beforeAll(async () => {
    // Initialize Vault Transit key (dev mode)
    await initializeVaultKey();
  });

  describe('DEK Generation', () => {
    test('generates a valid base64 DEK', () => {
      const dek = generateDEK();
      expect(dek).toBeTruthy();
      expect(typeof dek).toBe('string');
      // Should be valid base64
      const decoded = Buffer.from(dek, 'base64');
      expect(decoded.length).toBe(32); // 256 bits
    });

    test('generates unique DEKs on successive calls', () => {
      const dek1 = generateDEK();
      const dek2 = generateDEK();
      expect(dek1).not.toBe(dek2);
    });
  });

  describe('Vault Transit DEK Encryption (KEK)', () => {
    test('encrypts DEK with KEK', async () => {
      const dek = generateDEK();
      const ciphertext = await encryptDEKWithKEK(dek);

      expect(ciphertext).toBeTruthy();
      expect(typeof ciphertext).toBe('string');
      // Vault Transit ciphertext starts with vault:v1:
      expect(ciphertext).toMatch(/^vault:v\d+:/);
    });

    test('roundtrip: encrypt then decrypt DEK returns original', async () => {
      const originalDek = generateDEK();
      const encryptedDek = await encryptDEKWithKEK(originalDek);
      const decryptedDek = await decryptDEKWithKEK(encryptedDek);

      expect(decryptedDek).toBe(originalDek);
    });

    test('encrypted DEK is not readable as plaintext', async () => {
      const dek = generateDEK();
      const encryptedDek = await encryptDEKWithKEK(dek);

      // Encrypted DEK should not contain the original base64 content
      expect(encryptedDek).not.toContain(dek);
      // Should not be valid base64 encoding of the same bytes
      const decrypted = await decryptDEKWithKEK(encryptedDek);
      expect(decrypted).toBe(dek); // But it decrypts correctly
    });

    test('different DEKs produce different ciphertexts', async () => {
      const dek1 = generateDEK();
      const dek2 = generateDEK();

      const enc1 = await encryptDEKWithKEK(dek1);
      const enc2 = await encryptDEKWithKEK(dek2);

      expect(enc1).not.toBe(enc2);
    });
  });

  describe('Embedding Encryption (DEK)', () => {
    test('encrypts embedding with DEK', () => {
      const embedding = Array.from({ length: 512 }, () => Math.random());
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);

      expect(envelope).toBeDefined();
      expect(envelope.version).toBe(1);
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.iv).toBeTruthy();
      expect(envelope.authTag).toBeTruthy();
      expect(envelope.ciphertext).toBeTruthy();
    });

    test('roundtrip: encrypt then decrypt embedding returns original', () => {
      const embedding = Array.from({ length: 512 }, () => Math.random());
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);
      const decrypted = decryptEmbedding(envelope, dek);

      expect(decrypted).toEqual(embedding);
    });

    test('encrypted embedding is not readable as plaintext', () => {
      const embedding = Array.from({ length: 512 }, () => Math.random());
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);

      // Ciphertext should not contain the plaintext JSON
      const plaintext = JSON.stringify(embedding);
      const ciphertextBytes = Buffer.from(envelope.ciphertext, 'base64').toString('binary');
      expect(ciphertextBytes).not.toContain(plaintext);
    });

    test('different DEKs produce different ciphertexts for same embedding', () => {
      const embedding = Array.from({ length: 10 }, () => 0.5);
      const dek1 = generateDEK();
      const dek2 = generateDEK();

      const env1 = encryptEmbedding(embedding, dek1);
      const env2 = encryptEmbedding(embedding, dek2);

      // Ciphertexts should be different
      expect(env1.ciphertext).not.toBe(env2.ciphertext);
      // IVs should also be different
      expect(env1.iv).not.toBe(env2.iv);
    });

    test('decryption fails with wrong DEK', () => {
      const embedding = Array.from({ length: 10 }, () => 0.5);
      const dek1 = generateDEK();
      const dek2 = generateDEK();

      const envelope = encryptEmbedding(embedding, dek1);

      expect(() => {
        decryptEmbedding(envelope, dek2);
      }).toThrow();
    });

    test('decryption fails with tampered ciphertext', () => {
      const embedding = Array.from({ length: 10 }, () => 0.5);
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);

      // Tamper with ciphertext
      const tamperedEnvelope: EncryptedEnvelope = {
        ...envelope,
        ciphertext: Buffer.from('tampered-data').toString('base64'),
      };

      expect(() => {
        decryptEmbedding(tamperedEnvelope, dek);
      }).toThrow();
    });
  });

  describe('Full Storage Roundtrip (KEK + DEK)', () => {
    test('end-to-end: encrypt embedding for storage and decrypt', async () => {
      const embedding = Array.from({ length: 512 }, () => Math.random());
      const userId = `test-user-${Date.now()}`;

      // In-memory DEK store
      const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();

      const stored = await encryptEmbeddingForStorage(
        embedding,
        userId,
        async (uid) => userDeks.get(uid) || null,
        async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      expect(stored.envelope).toBeDefined();
      expect(stored.encryptedDek).toMatch(/^vault:v\d+:/);

      const decrypted = await decryptEmbeddingFromStorage(
        stored,
        userId,
        async (uid) => userDeks.get(uid) || null
      );

      expect(decrypted).toEqual(embedding);
    });

    test('second encrypt uses existing DEK (no new DEK generated)', async () => {
      const userId = `test-reuse-${Date.now()}`;
      const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();

      const embedding1 = Array.from({ length: 10 }, () => 0.1);
      const embedding2 = Array.from({ length: 10 }, () => 0.2);

      const stored1 = await encryptEmbeddingForStorage(
        embedding1,
        userId,
        async (uid) => userDeks.get(uid) || null,
        async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      const stored2 = await encryptEmbeddingForStorage(
        embedding2,
        userId,
        async (uid) => userDeks.get(uid) || null,
        async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      // Same encrypted DEK (same user DEK reused)
      expect(stored1.encryptedDek).toBe(stored2.encryptedDek);
      // But different ciphertexts (different IV per encryption)
      expect(stored1.envelope.ciphertext).not.toBe(stored2.envelope.ciphertext);
    });

    test('biometric face embedding (512-dim) encrypts correctly', async () => {
      // Simulate ArcFace 512-dimensional embedding
      const faceEmbedding = Array.from({ length: 512 }, () => (Math.random() * 2 - 1));
      const userId = `test-face-${Date.now()}`;
      const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();

      const stored = await encryptEmbeddingForStorage(
        faceEmbedding,
        userId,
        async (uid) => userDeks.get(uid) || null,
        async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      const decrypted = await decryptEmbeddingFromStorage(
        stored,
        userId,
        async (uid) => userDeks.get(uid) || null
      );

      expect(decrypted.length).toBe(512);
      // Check each value matches within float precision
      for (let i = 0; i < faceEmbedding.length; i++) {
        expect(decrypted[i]).toBeCloseTo(faceEmbedding[i], 10);
      }
    });

    test('biometric voice embedding (256-dim) encrypts correctly', async () => {
      // Simulate ECAPA-TDNN 256-dimensional embedding
      const voiceEmbedding = Array.from({ length: 256 }, () => (Math.random() * 2 - 1));
      const userId = `test-voice-${Date.now()}`;
      const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();

      const stored = await encryptEmbeddingForStorage(
        voiceEmbedding,
        userId,
        async (uid) => userDeks.get(uid) || null,
        async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
      );

      const decrypted = await decryptEmbeddingFromStorage(
        stored,
        userId,
        async (uid) => userDeks.get(uid) || null
      );

      expect(decrypted.length).toBe(256);
      for (let i = 0; i < voiceEmbedding.length; i++) {
        expect(decrypted[i]).toBeCloseTo(voiceEmbedding[i], 10);
      }
    });
  });

  describe('Envelope Version Protection', () => {
    test('rejects unsupported envelope version', () => {
      const embedding = Array.from({ length: 10 }, () => 0.5);
      const dek = generateDEK();

      const badEnvelope: EncryptedEnvelope = {
        version: 99,
        keyId: 'user-dek',
        iv: '',
        authTag: '',
        ciphertext: '',
        algorithm: 'aes-256-gcm',
      };

      expect(() => {
        decryptEmbedding(badEnvelope, dek);
      }).toThrow('Unsupported envelope version: 99');
    });

    test('rejects unsupported algorithm', () => {
      const badEnvelope: EncryptedEnvelope = {
        version: 1,
        keyId: 'user-dek',
        iv: '',
        authTag: '',
        ciphertext: '',
        algorithm: 'aes-128-cbc' as any,
      };

      const dek = generateDEK();

      expect(() => {
        decryptEmbedding(badEnvelope, dek);
      }).toThrow('Unsupported algorithm');
    });
  });
});
