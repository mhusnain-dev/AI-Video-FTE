/**
 * Unit tests for Configuration Loader
 * Targets 100% branch coverage for src/shared/config.ts
 */

// ===== MOCKS =====

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('yaml', () => ({
  parse: jest.fn((content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }),
}));

jest.mock('dotenv/config', () => ({}));

// ===== TESTS =====

describe('Configuration Loader', () => {
  const originalEnv = process.env;
  let mockExistsSync: jest.Mock;
  let mockReadFileSync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    const fs = require('fs');
    mockExistsSync = fs.existsSync;
    mockReadFileSync = fs.readFileSync;
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');

    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.CONFIG_DIR;
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_PASSWORD_FILE;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_PASSWORD_FILE;
    delete process.env.VAULT_ADDR;
    delete process.env.VAULT_TOKEN;
    delete process.env.VAULT_TOKEN_FILE;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY_FILE;
    delete process.env.VEO_API_KEY;
    delete process.env.VEO_API_KEY_FILE;
    delete process.env.RUNWAY_API_KEY;
    delete process.env.RUNWAY_API_KEY_FILE;
    delete process.env.KIE_API_KEY;
    delete process.env.KIE_API_KEY_FILE;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY_FILE;
    delete process.env.NVIDIA_NIM_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY_FILE;
    delete process.env.ADMIN_EMAIL;
    delete process.env.FRONTEND_URL;
    delete process.env.LUMA_API_KEY;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.KIE_CALLBACK_URL;
    delete process.env.ALERTMANAGER_WEBHOOK_URL;
    delete process.env.ARCHIVE_BACKEND;
    delete process.env.ARCHIVE_BUCKET;
    delete process.env.ARCHIVE_LOCAL_PATH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadFreshConfig() {
    const configModule = require('../../../src/shared/config');
    return configModule.config;
  }

  describe('defaults', () => {
    test('loads default postgres config', () => {
      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('localhost');
      expect(config.postgres.port).toBe(5432);
      expect(config.postgres.database).toBe('ai_video_fte');
      expect(config.postgres.user).toBe('postgres');
      expect(config.postgres.password).toBe('postgres');
      expect(config.postgres.ssl).toBe(false);
      expect(config.postgres.poolSize).toBe(20);
    });

    test('has default redis config', () => {
      const config = loadFreshConfig();
      expect(config.redis.host).toBe('localhost');
      expect(config.redis.port).toBe(6379);
      expect(config.redis.db).toBe(0);
      expect(config.redis.connectionPoolSize).toBe(10);
    });

    test('has default vault config', () => {
      const config = loadFreshConfig();
      expect(config.vault.address).toBe('http://localhost:8200');
      expect(config.vault.token).toBe('root');
      expect(config.vault.transitKeyName).toBe('biometric-encryption');
      expect(config.vault.rotationIntervalDays).toBe(90);
    });

    test('has default router config', () => {
      const config = loadFreshConfig();
      expect(config.router.systemDefaultPriority).toEqual([
        'kie-veo3-fast', 'kie-veo3-quality', 'kie-veo3-lite', 'runway-gen3',
      ]);
      expect(config.router.eligibilityCheckEnabled).toBe(true);
    });

    test('has default admission config', () => {
      const config = loadFreshConfig();
      expect(config.admission.moderation.provider).toBe('built-in');
      expect(config.admission.moderation.threshold).toBe(0.8);
      expect(config.admission.sacredGuard.visualSimilarityThreshold).toBe(0.775);
      expect(config.admission.costGuard.userBudgetUsd).toBe(100.00);
      expect(config.admission.rateLimit.perUser).toBe(20);
    });

    test('has default dispatch config', () => {
      const config = loadFreshConfig();
      expect(config.dispatch.watchdogPollIntervalMs).toBe(30000);
      expect(config.dispatch.watchdogMaxWaitMs).toBe(600000);
      expect(config.dispatch.maxFallbackAttempts).toBe(3);
    });

    test('has default merger config', () => {
      const config = loadFreshConfig();
      expect(config.merger.defaultTransition.type).toBe('crossfade');
      expect(config.merger.defaultTransition.durationSeconds).toBe(0.5);
      expect(config.merger.ffmpegPath).toBe('ffmpeg');
      expect(config.merger.supportedFormats).toEqual(['mp4']);
      expect(config.merger.maxMergeTimeMs).toBe(300000);
    });

    test('has default observability config', () => {
      const config = loadFreshConfig();
      expect(config.observability.metricsPort).toBe(9090);
      expect(config.observability.healthCheckIntervalMs).toBe(30000);
      expect(config.observability.auditRetentionYears).toBe(7);
      expect(config.observability.archive.backend).toBe('local');
    });

    test('has default smtp config', () => {
      const config = loadFreshConfig();
      expect(config.smtp.host).toBe('smtp.example.com');
      expect(config.smtp.port).toBe(587);
      expect(config.smtp.fromEmail).toBe('noreply@example.com');
    });

    test('has default facelock config', () => {
      const config = loadFreshConfig();
      expect(config.faceLock.maxRetries).toBe(2);
    });

    test('has default modelRegistry config', () => {
      const config = loadFreshConfig();
      expect(config.modelRegistry.models).toEqual([]);
      expect(config.modelRegistry.refreshIntervalMs).toBe(300000);
    });

    test('has default storyIngestion config', () => {
      const config = loadFreshConfig();
      expect(config.storyIngestion.maxDecompositionTimeMs).toBe(10000);
      expect(config.storyIngestion.maxShotsPerStory).toBe(100);
    });
  });

  describe('config file loading', () => {
    test('loads YAML config file when it exists', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('.yaml'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.yaml')) {
          return JSON.stringify({ postgres: { host: 'file-host', port: 5433 } });
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('file-host');
      expect(config.postgres.port).toBe(5433);
      expect(config.postgres.database).toBe('ai_video_fte');
    });

    test('uses NODE_ENV to select config file', () => {
      process.env.NODE_ENV = 'production';
      mockExistsSync.mockImplementation((p: string) => p.endsWith('.yaml'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.yaml')) {
          return JSON.stringify({ postgres: { host: 'prod-host' } });
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining('production.yaml')
      );
      expect(config.postgres.host).toBe('prod-host');
    });

    test('falls back to defaults when config file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('localhost');
    });
  });

  describe('env overrides - postgres', () => {
    test('overrides postgres host from env', () => {
      process.env.POSTGRES_HOST = 'env-pg-host';
      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('env-pg-host');
    });

    test('overrides postgres password from env', () => {
      process.env.POSTGRES_PASSWORD = 'secret-pw';
      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('secret-pw');
    });

    test('overrides all postgres settings from env', () => {
      process.env.POSTGRES_HOST = 'env-host';
      process.env.POSTGRES_PORT = '5433';
      process.env.POSTGRES_DB = 'mydb';
      process.env.POSTGRES_USER = 'myuser';
      process.env.POSTGRES_SSL = 'true';
      process.env.POSTGRES_POOL_SIZE = '50';
      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('env-host');
      expect(config.postgres.port).toBe(5433);
      expect(config.postgres.database).toBe('mydb');
      expect(config.postgres.user).toBe('myuser');
      expect(config.postgres.ssl).toBe(true);
      expect(config.postgres.poolSize).toBe(50);
    });

    test('reads postgres password from _FILE env var', () => {
      process.env.POSTGRES_PASSWORD_FILE = '/run/secrets/pg_pass';
      process.env.POSTGRES_HOST = 'host';
      mockExistsSync.mockImplementation((p: string) => p === '/run/secrets/pg_pass');
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === '/run/secrets/pg_pass') return 'file-secret\n';
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('file-secret');
    });
  });

  describe('env overrides - redis', () => {
    test('overrides redis host from env', () => {
      process.env.REDIS_HOST = 'env-redis-host';
      const config = loadFreshConfig();
      expect(config.redis.host).toBe('env-redis-host');
    });

    test('overrides all redis settings from env', () => {
      process.env.REDIS_HOST = 'env-host';
      process.env.REDIS_PASSWORD = 'redis-secret';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_DB = '3';
      process.env.REDIS_POOL_SIZE = '25';
      const config = loadFreshConfig();
      expect(config.redis.host).toBe('env-host');
      expect(config.redis.password).toBe('redis-secret');
      expect(config.redis.port).toBe(6380);
      expect(config.redis.db).toBe(3);
      expect(config.redis.connectionPoolSize).toBe(25);
    });

    test('reads redis password from _FILE env var', () => {
      process.env.REDIS_PASSWORD_FILE = '/run/secrets/redis_pass';
      process.env.REDIS_HOST = 'host';
      mockExistsSync.mockImplementation((p: string) => p === '/run/secrets/redis_pass');
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === '/run/secrets/redis_pass') return 'redis-file-secret\n';
        return '';
      });

      const config = loadFreshConfig();
      expect(config.redis.password).toBe('redis-file-secret');
    });
  });

  describe('env overrides - vault', () => {
    test('overrides all vault settings from env', () => {
      process.env.VAULT_ADDR = 'http://vault:8200';
      process.env.VAULT_TOKEN = 'hvac-token';
      process.env.VAULT_TRANSIT_KEY = 'my-key';
      process.env.VAULT_ROTATION_DAYS = '30';
      const config = loadFreshConfig();
      expect(config.vault.address).toBe('http://vault:8200');
      expect(config.vault.token).toBe('hvac-token');
      expect(config.vault.transitKeyName).toBe('my-key');
      expect(config.vault.rotationIntervalDays).toBe(30);
    });

    test('reads vault token from _FILE env var', () => {
      process.env.VAULT_TOKEN_FILE = '/run/secrets/vault_token';
      process.env.VAULT_ADDR = 'http://vault:8200';
      mockExistsSync.mockImplementation((p: string) => p === '/run/secrets/vault_token');
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === '/run/secrets/vault_token') return 'vault-file-token\n';
        return '';
      });

      const config = loadFreshConfig();
      expect(config.vault.token).toBe('vault-file-token');
    });

    test('uses default host when only vault token provided via secret', () => {
      process.env.VAULT_TOKEN = 'token-only';
      const config = loadFreshConfig();
      expect(config.vault.address).toBe('http://localhost:8200');
      expect(config.vault.token).toBe('token-only');
    });

    test('uses default token when only vault address provided', () => {
      process.env.VAULT_ADDR = 'http://vault:8200';
      const config = loadFreshConfig();
      expect(config.vault.address).toBe('http://vault:8200');
      expect(config.vault.token).toBe('root');
    });
  });

  describe('env overrides - redis fallback', () => {
    test('uses default host when only redis password provided', () => {
      process.env.REDIS_PASSWORD = 'pw-only';
      const config = loadFreshConfig();
      expect(config.redis.host).toBe('localhost');
      expect(config.redis.password).toBe('pw-only');
    });
  });

  describe('env overrides - API keys', () => {
    test('sets all API keys from env', () => {
      process.env.ELEVENLABS_API_KEY = 'el-key';
      process.env.VEO_API_KEY = 'veo-key';
      process.env.RUNWAY_API_KEY = 'rw-key';
      process.env.KIE_API_KEY = 'kie-key';
      process.env.LLM_API_KEY = 'llm-key';
      process.env.NVIDIA_NIM_API_KEY = 'nv-key';
      const config = loadFreshConfig();
      expect(config.elevenlabsApiKey).toBe('el-key');
      expect(config.veoApiKey).toBe('veo-key');
      expect(config.runwayApiKey).toBe('rw-key');
      expect(config.kieApiKey).toBe('kie-key');
      expect(config.llmApiKey).toBe('llm-key');
      expect(config.nvidiaNimApiKey).toBe('nv-key');
    });

    test('reads API keys from _FILE env vars', () => {
      process.env.ELEVENLABS_API_KEY_FILE = '/run/secrets/el_key';
      process.env.VEO_API_KEY_FILE = '/run/secrets/veo_key';
      process.env.RUNWAY_API_KEY_FILE = '/run/secrets/rw_key';
      process.env.KIE_API_KEY_FILE = '/run/secrets/kie_key';
      process.env.LLM_API_KEY_FILE = '/run/secrets/llm_key';
      process.env.NVIDIA_NIM_API_KEY_FILE = '/run/secrets/nv_key';

      mockExistsSync.mockImplementation((p: string) => p.startsWith('/run/secrets/'));
      mockReadFileSync.mockImplementation((p: string) => {
        const map: Record<string, string> = {
          '/run/secrets/el_key': 'el-file-key\n',
          '/run/secrets/veo_key': 'veo-file-key\n',
          '/run/secrets/rw_key': 'rw-file-key\n',
          '/run/secrets/kie_key': 'kie-file-key\n',
          '/run/secrets/llm_key': 'llm-file-key\n',
          '/run/secrets/nv_key': 'nv-file-key\n',
        };
        return map[p] || '';
      });

      const config = loadFreshConfig();
      expect(config.elevenlabsApiKey).toBe('el-file-key');
      expect(config.veoApiKey).toBe('veo-file-key');
      expect(config.runwayApiKey).toBe('rw-file-key');
      expect(config.kieApiKey).toBe('kie-file-key');
      expect(config.llmApiKey).toBe('llm-file-key');
      expect(config.nvidiaNimApiKey).toBe('nv-file-key');
    });
  });

  describe('env overrides - other', () => {
    test('sets admin email from env', () => {
      process.env.ADMIN_EMAIL = 'admin@example.com';
      const config = loadFreshConfig();
      expect(config.adminEmail).toBe('admin@example.com');
    });

    test('sets frontend URL from env', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      const config = loadFreshConfig();
      expect(config.frontendUrl).toBe('https://app.example.com');
    });
  });

  describe('SMTP from secrets file', () => {
    test('loads SMTP config from secrets/smtp.txt', () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('smtp.txt'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('smtp.txt')) {
          return 'smtp.gmail.com\n587\nuser@gmail.com\napp-password\nnoreply@gmail.com\n';
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.smtp.host).toBe('smtp.gmail.com');
      expect(config.smtp.port).toBe(587);
      expect(config.smtp.user).toBe('user@gmail.com');
      expect(config.smtp.pass).toBe('app-password');
      expect(config.smtp.fromEmail).toBe('noreply@gmail.com');
    });

    test('ignores SMTP file with less than 5 lines', () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('smtp.txt'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('smtp.txt')) {
          return 'smtp.gmail.com\n587\n';
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.smtp.host).toBe('smtp.example.com');
    });

    test('skips comment and empty lines in SMTP file', () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('smtp.txt'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('smtp.txt')) {
          return '# comment\n\nsmtp.gmail.com\n587\nuser\npass\nfrom@example.com\n';
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.smtp.host).toBe('smtp.gmail.com');
    });
  });

  describe('readSecretFile error handling', () => {
    test('returns undefined when readFileSync throws', () => {
      process.env.POSTGRES_PASSWORD_FILE = '/run/secrets/pg_pass';
      process.env.POSTGRES_HOST = 'host';
      mockExistsSync.mockImplementation((p: string) => p === '/run/secrets/pg_pass');
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === '/run/secrets/pg_pass') throw new Error('EACCES');
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('postgres');
    });

    test('returns undefined when file does not exist', () => {
      process.env.POSTGRES_PASSWORD_FILE = '/nonexistent/file';
      process.env.POSTGRES_HOST = 'host';
      mockExistsSync.mockReturnValue(false);

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('postgres');
    });
  });

  describe('secret lookup chain', () => {
    test('falls back to standard Docker secrets path', () => {
      process.env.POSTGRES_HOST = 'host';
      mockExistsSync.mockImplementation((p: string) => p === '/run/secrets/postgres_password');
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === '/run/secrets/postgres_password') return 'docker-secret\n';
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('docker-secret');
    });

    test('falls back to local secrets directory', () => {
      process.env.POSTGRES_HOST = 'host';
      mockExistsSync.mockImplementation((p: string) => p.includes('secrets/postgres_password.txt'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('secrets/postgres_password.txt')) return 'local-secret\n';
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('local-secret');
    });

    test('falls back to env var when no file found', () => {
      process.env.POSTGRES_HOST = 'host';
      process.env.POSTGRES_PASSWORD = 'env-password';
      mockExistsSync.mockReturnValue(false);

      const config = loadFreshConfig();
      expect(config.postgres.password).toBe('env-password');
    });
  });

  describe('deepMerge', () => {
    test('merges nested objects deeply via file config', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('.yaml'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.yaml')) {
          return JSON.stringify({ postgres: { host: 'file-host' } });
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('file-host');
      expect(config.postgres.port).toBe(5432);
      expect(config.postgres.database).toBe('ai_video_fte');
    });

    test('env overrides take precedence over file config', () => {
      process.env.POSTGRES_HOST = 'env-host';
      mockExistsSync.mockImplementation((p: string) => p.endsWith('.yaml'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.yaml')) {
          return JSON.stringify({ postgres: { host: 'file-host' } });
        }
        return '';
      });

      const config = loadFreshConfig();
      expect(config.postgres.host).toBe('env-host');
    });

    test('merges new nested key from file config not present in defaults', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('.yaml'));
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.yaml')) {
          return JSON.stringify({ customSection: { nestedKey: 'nestedValue' } });
        }
        return '';
      });

      const config = loadFreshConfig();
      expect((config as any).customSection).toEqual({ nestedKey: 'nestedValue' });
    });
  });
});
