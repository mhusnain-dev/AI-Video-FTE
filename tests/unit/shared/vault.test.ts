import {
  getVaultClient,
  generateDEK,
  encryptDEKWithKEK,
  decryptDEKWithKEK,
  encryptEmbedding,
  decryptEmbedding,
  encryptEmbeddingForStorage,
  decryptEmbeddingFromStorage,
  rotateUserDek,
  rotateAllUserDeks,
  rotateVaultTransitKey,
  initializeVaultKey,
} from '../../../src/shared/vault';

jest.mock('../../../src/shared/config', () => ({
  config: {
    vault: {
      address: 'http://localhost:8200',
      token: 'test-token',
      transitKeyName: 'test-key',
      rotationIntervalDays: 90,
    },
  },
}));

jest.mock('node-vault', () => {
  const mockClient = {
    write: jest.fn().mockResolvedValue({ data: { ciphertext: 'vault:v1:new-ciphertext' } }),
    read: jest.fn().mockResolvedValue({ data: { type: 'aes256-gcm96' } }),
    encryptData: jest.fn().mockResolvedValue({ data: { ciphertext: 'vault:v1:encrypted-dek' } }),
    decryptData: jest.fn().mockResolvedValue({ data: { plaintext: Buffer.from('test-dek-base64').toString('base64') } }),
  };
  return jest.fn(() => mockClient);
});

jest.mock('../../../src/shared/metrics', () => ({
  vaultEncryptTotal: { inc: jest.fn() },
  vaultDecryptTotal: { inc: jest.fn() },
  vaultEncryptDurationSeconds: { observe: jest.fn() },
  vaultDecryptDurationSeconds: { observe: jest.fn() },
  vaultDEKRotationTotal: { inc: jest.fn() },
  vaultKEKRotationTotal: { inc: jest.fn() },
  vaultStatusGauge: { set: jest.fn() },
}));

const vault = require('node-vault');
const metrics = require('../../../src/shared/metrics');

describe('Vault', () => {
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton
    (getVaultClient as any).vaultClient = undefined;
    // Get a fresh mock client
    mockClient = vault();
  });

  describe('getVaultClient', () => {
    test('creates vault client on first call', () => {
      const client = getVaultClient();
      expect(client).toBeDefined();
      expect(vault).toHaveBeenCalledWith({
        endpoint: 'http://localhost:8200',
        token: 'test-token',
      });
      expect(metrics.vaultStatusGauge.set).toHaveBeenCalledWith(1);
    });

    test('returns same client on subsequent calls', () => {
      const client1 = getVaultClient();
      const client2 = getVaultClient();
      expect(client1).toBe(client2);
      expect(vault).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateDEK', () => {
    test('returns base64-encoded 32-byte key', () => {
      const dek = generateDEK();
      expect(typeof dek).toBe('string');
      const buf = Buffer.from(dek, 'base64');
      expect(buf.length).toBe(32);
    });

    test('generates unique keys on each call', () => {
      const dek1 = generateDEK();
      const dek2 = generateDEK();
      expect(dek1).not.toBe(dek2);
    });
  });

  describe('encryptDEKWithKEK', () => {
    test('encrypts DEK using Vault Transit', async () => {
      const ciphertext = await encryptDEKWithKEK('test-dek-base64');
      expect(ciphertext).toBe('vault:v1:encrypted-dek');
      expect(mockClient.encryptData).toHaveBeenCalledWith({
        name: 'test-key',
        plaintext: 'test-dek-base64',
      });
      expect(metrics.vaultEncryptTotal.inc).toHaveBeenCalledWith({ status: 'success' });
    });

    test('records duration metric after encryption', async () => {
      await encryptDEKWithKEK('test-dek-base64');
      expect(metrics.vaultEncryptDurationSeconds.observe).toHaveBeenCalled();
    });

    test('throws and records error metric on failure', async () => {
      mockClient.encryptData.mockRejectedValueOnce(new Error('Vault error'));

      await expect(encryptDEKWithKEK('test-dek-base64')).rejects.toThrow('Vault error');
      expect(metrics.vaultEncryptTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });
  });

  describe('decryptDEKWithKEK', () => {
    test('decrypts DEK using Vault Transit', async () => {
      const dek = await decryptDEKWithKEK('vault:v1:encrypted-dek');
      expect(dek).toBe(Buffer.from('test-dek-base64').toString('base64'));
      expect(mockClient.decryptData).toHaveBeenCalledWith({
        name: 'test-key',
        ciphertext: 'vault:v1:encrypted-dek',
      });
      expect(metrics.vaultDecryptTotal.inc).toHaveBeenCalledWith({ status: 'success' });
    });

    test('records duration metric after decryption', async () => {
      await decryptDEKWithKEK('vault:v1:encrypted-dek');
      expect(metrics.vaultDecryptDurationSeconds.observe).toHaveBeenCalled();
    });

    test('throws and records error metric on failure', async () => {
      mockClient.decryptData.mockRejectedValueOnce(new Error('Decrypt failed'));

      await expect(decryptDEKWithKEK('vault:v1:bad')).rejects.toThrow('Decrypt failed');
      expect(metrics.vaultDecryptTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });
  });

  describe('encryptEmbedding', () => {
    test('encrypts embedding and returns envelope', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);

      expect(envelope.version).toBe(1);
      expect(envelope.keyId).toBe('user-dek');
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.iv).toBeDefined();
      expect(envelope.authTag).toBeDefined();
      expect(envelope.ciphertext).toBeDefined();
    });

    test('produces different ciphertext for different IVs', () => {
      const embedding = [0.1, 0.2, 0.3];
      const dek = generateDEK();

      const envelope1 = encryptEmbedding(embedding, dek);
      const envelope2 = encryptEmbedding(embedding, dek);

      // Very unlikely to have same IVs
      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
    });
  });

  describe('decryptEmbedding', () => {
    test('decrypts embedding from envelope', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);
      const decrypted = decryptEmbedding(envelope, dek);

      expect(decrypted).toEqual(embedding);
    });

    test('throws on unsupported envelope version', () => {
      const dek = generateDEK();
      const envelope = {
        version: 99,
        keyId: 'user-dek',
        iv: 'dGVzdA==',
        authTag: 'dGVzdA==',
        ciphertext: 'dGVzdA==',
        algorithm: 'aes-256-gcm' as const,
      };

      expect(() => decryptEmbedding(envelope, dek)).toThrow('Unsupported envelope version: 99');
    });

    test('throws on unsupported algorithm', () => {
      const dek = generateDEK();
      const envelope = {
        version: 1,
        keyId: 'user-dek',
        iv: 'dGVzdA==',
        authTag: 'dGVzdA==',
        ciphertext: 'dGVzdA==',
        algorithm: 'aes-128-cbc' as any,
      };

      expect(() => decryptEmbedding(envelope, dek)).toThrow('Unsupported algorithm: aes-128-cbc');
    });

    test('roundtrips complex embedding data', () => {
      const embedding = Array.from({ length: 512 }, (_, i) => Math.sin(i));
      const dek = generateDEK();

      const envelope = encryptEmbedding(embedding, dek);
      const decrypted = decryptEmbedding(envelope, dek);

      expect(decrypted.length).toBe(512);
      decrypted.forEach((val, i) => {
        expect(val).toBeCloseTo(Math.sin(i), 10);
      });
    });
  });

  describe('encryptEmbeddingForStorage', () => {
    test('generates new DEK when user has none', async () => {
      const embedding = [0.1, 0.2];
      const getUserDek = jest.fn().mockResolvedValue(null);
      const storeUserDek = jest.fn().mockResolvedValue(undefined);

      const result = await encryptEmbeddingForStorage(embedding, 'user-1', getUserDek, storeUserDek);

      expect(result.envelope).toBeDefined();
      expect(result.encryptedDek).toBe('vault:v1:encrypted-dek');
      expect(getUserDek).toHaveBeenCalledWith('user-1');
      expect(storeUserDek).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        'vault:v1:encrypted-dek'
      );
    });

    test('reuses existing DEK when user has one', async () => {
      const embedding = [0.1, 0.2];
      const existingDek = { dekBase64: generateDEK(), encryptedDek: 'vault:v1:existing' };
      const getUserDek = jest.fn().mockResolvedValue(existingDek);
      const storeUserDek = jest.fn().mockResolvedValue(undefined);

      const result = await encryptEmbeddingForStorage(embedding, 'user-1', getUserDek, storeUserDek);

      expect(result.envelope).toBeDefined();
      expect(result.encryptedDek).toBe('vault:v1:existing');
      expect(storeUserDek).not.toHaveBeenCalled();
    });

    test('stores newly generated DEK for future use', async () => {
      const embedding = [0.5, 0.6];
      const getUserDek = jest.fn().mockResolvedValue(null);
      const storeUserDek = jest.fn().mockResolvedValue(undefined);

      await encryptEmbeddingForStorage(embedding, 'user-1', getUserDek, storeUserDek);

      expect(storeUserDek).toHaveBeenCalledTimes(1);
      const [userId, dekBase64, encryptedDek] = storeUserDek.mock.calls[0];
      expect(userId).toBe('user-1');
      expect(typeof dekBase64).toBe('string');
      expect(encryptedDek).toBe('vault:v1:encrypted-dek');
    });
  });

  describe('decryptEmbeddingFromStorage', () => {
    test('decrypts embedding using user DEK', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const dek = generateDEK();
      const envelope = encryptEmbedding(embedding, dek);
      const stored = { envelope, encryptedDek: 'vault:v1:something' };

      const getUserDek = jest.fn().mockResolvedValue({ dekBase64: dek, encryptedDek: 'vault:v1:something' });

      const decrypted = await decryptEmbeddingFromStorage(stored, 'user-1', getUserDek);
      expect(decrypted).toEqual(embedding);
    });

    test('throws when user DEK not found', async () => {
      const embedding = [0.1, 0.2];
      const dek = generateDEK();
      const envelope = encryptEmbedding(embedding, dek);
      const stored = { envelope, encryptedDek: 'vault:v1:something' };

      const getUserDek = jest.fn().mockResolvedValue(null);

      await expect(
        decryptEmbeddingFromStorage(stored, 'user-1', getUserDek)
      ).rejects.toThrow('No DEK found for user user-1');
    });
  });

  describe('rotateUserDek', () => {
    test('rewraps DEK with new KEK version', async () => {
      const getUserDek = jest.fn().mockResolvedValue({
        dekBase64: 'test-dek',
        encryptedDek: 'vault:v1:old-ciphertext',
      });
      const updateUserDek = jest.fn().mockResolvedValue(undefined);

      mockClient.write.mockResolvedValueOnce({
        data: { ciphertext: 'vault:v2:new-ciphertext' },
      });

      await rotateUserDek('user-1', getUserDek, updateUserDek);

      expect(mockClient.write).toHaveBeenCalledWith(
        'transit/rewrap/test-key',
        { ciphertext: 'vault:v1:old-ciphertext' }
      );
      expect(updateUserDek).toHaveBeenCalledWith('user-1', 'vault:v2:new-ciphertext');
      expect(metrics.vaultDEKRotationTotal.inc).toHaveBeenCalledWith({ status: 'success' });
    });

    test('throws when user DEK not found', async () => {
      const getUserDek = jest.fn().mockResolvedValue(null);
      const updateUserDek = jest.fn();

      await expect(
        rotateUserDek('user-1', getUserDek, updateUserDek)
      ).rejects.toThrow('No DEK found for user user-1 to rotate');
    });

    test('records error metric on rewrap failure', async () => {
      const getUserDek = jest.fn().mockResolvedValue({
        dekBase64: 'test-dek',
        encryptedDek: 'vault:v1:old',
      });
      const updateUserDek = jest.fn();

      mockClient.write.mockRejectedValueOnce(new Error('Rewrap failed'));

      await expect(
        rotateUserDek('user-1', getUserDek, updateUserDek)
      ).rejects.toThrow('Rewrap failed');
      expect(metrics.vaultDEKRotationTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });
  });

  describe('rotateAllUserDeks', () => {
    test('rotates all user DEKs and returns counts', async () => {
      const getAllUserIds = jest.fn().mockResolvedValue(['user-1', 'user-2', 'user-3']);
      const getUserDek = jest.fn().mockResolvedValue({
        dekBase64: 'test-dek',
        encryptedDek: 'vault:v1:old',
      });
      const updateUserDek = jest.fn().mockResolvedValue(undefined);

      mockClient.write.mockResolvedValue({
        data: { ciphertext: 'vault:v2:new' },
      });

      const result = await rotateAllUserDeks(getAllUserIds, getUserDek, updateUserDek);

      expect(result.rotated).toBe(3);
      expect(result.failed).toBe(0);
      expect(updateUserDek).toHaveBeenCalledTimes(3);
    });

    test('counts failures without stopping', async () => {
      const getAllUserIds = jest.fn().mockResolvedValue(['user-1', 'user-2']);
      const getUserDek = jest.fn()
        .mockResolvedValueOnce({
          dekBase64: 'test-dek',
          encryptedDek: 'vault:v1:old',
        })
        .mockRejectedValueOnce(new Error('User 2 DEK not found'));
      const updateUserDek = jest.fn().mockResolvedValue(undefined);

      mockClient.write.mockResolvedValue({
        data: { ciphertext: 'vault:v2:new' },
      });

      const result = await rotateAllUserDeks(getAllUserIds, getUserDek, updateUserDek);

      expect(result.rotated).toBe(1);
      expect(result.failed).toBe(1);
    });

    test('handles empty user list', async () => {
      const getAllUserIds = jest.fn().mockResolvedValue([]);
      const getUserDek = jest.fn();
      const updateUserDek = jest.fn();

      const result = await rotateAllUserDeks(getAllUserIds, getUserDek, updateUserDek);

      expect(result.rotated).toBe(0);
      expect(result.failed).toBe(0);
      expect(getUserDek).not.toHaveBeenCalled();
    });

    test('handles all failures', async () => {
      const getAllUserIds = jest.fn().mockResolvedValue(['user-1', 'user-2']);
      const getUserDek = jest.fn().mockRejectedValue(new Error('DEK error'));
      const updateUserDek = jest.fn();

      const result = await rotateAllUserDeks(getAllUserIds, getUserDek, updateUserDek);

      expect(result.rotated).toBe(0);
      expect(result.failed).toBe(2);
    });
  });

  describe('rotateVaultTransitKey', () => {
    test('calls Vault to rotate transit key', async () => {
      await rotateVaultTransitKey();

      expect(mockClient.write).toHaveBeenCalledWith(
        'transit/keys/test-key/rotate',
        {}
      );
      expect(metrics.vaultKEKRotationTotal.inc).toHaveBeenCalledWith({ status: 'success' });
    });

    test('records error metric on failure', async () => {
      mockClient.write.mockRejectedValueOnce(new Error('Rotation failed'));

      await expect(rotateVaultTransitKey()).rejects.toThrow('Rotation failed');
      expect(metrics.vaultKEKRotationTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });
  });

  describe('initializeVaultKey', () => {
    test('creates key if it does not exist', async () => {
      mockClient.read.mockRejectedValueOnce(new Error('Not found'));
      mockClient.write.mockResolvedValueOnce({ data: {} });

      await initializeVaultKey();

      expect(mockClient.read).toHaveBeenCalledWith('transit/keys/test-key');
      expect(mockClient.write).toHaveBeenCalledWith(
        'transit/keys/test-key',
        {
          type: 'aes256-gcm96',
          derivation: 'raw',
          exportable: false,
          allow_plaintext_backup: false,
        }
      );
    });

    test('does not create key if it already exists', async () => {
      mockClient.read.mockResolvedValueOnce({ data: { type: 'aes256-gcm96' } });

      await initializeVaultKey();

      expect(mockClient.read).toHaveBeenCalledWith('transit/keys/test-key');
      expect(mockClient.write).not.toHaveBeenCalled();
    });
  });
});
