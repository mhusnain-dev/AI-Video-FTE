/**
 * Configuration loader for AI Video FTE
 * Implements CL-001 through CL-023 configurable defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { AppConfig, PostgresConfig, RedisConfig, VaultConfig } from './types.js';

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');

/**
 * Read a secret from a file path, typically /run/secrets/<secret_name>
 * Returns undefined if file doesn't exist or can't be read
 */
function readSecretFile(filePath: string): string | undefined {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
  } catch {
    // Ignore errors, return undefined
  }
  return undefined;
}

/**
 * Get secret value from either _FILE env var, /run/secrets/, or regular env var
 */
function getSecret(
  fileEnvVar: string,
  secretName: string,
  envVar: string
): string | undefined {
  // 1. Check _FILE environment variable (e.g., POSTGRES_PASSWORD_FILE)
  const filePath = process.env[fileEnvVar];
  if (filePath) {
    const value = readSecretFile(filePath);
    if (value) return value;
  }
  // 2. Check standard Docker secrets location
  const standardPath = `/run/secrets/${secretName}`;
  const value = readSecretFile(standardPath);
  if (value) return value;
  // 3. Fall back to regular environment variable
  return process.env[envVar];
}

export function loadConfig(): AppConfig {
  const env = process.env.NODE_ENV || 'development';
  const configFile = path.join(CONFIG_DIR, `${env}.yaml`);

  let fileConfig: Partial<AppConfig> = {};
  if (fs.existsSync(configFile)) {
    const fileContent = fs.readFileSync(configFile, 'utf8');
    fileConfig = yaml.parse(fileContent);
  }

  return mergeConfig(getDefaults(), fileConfig, getEnvOverrides());
}

function getDefaults(): AppConfig {
  return {
    postgres: {
      host: 'localhost',
      port: 5432,
      database: 'ai_video_fte',
      user: 'postgres',
      password: 'postgres',
      ssl: false,
      poolSize: 20,
    },
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0,
      connectionPoolSize: 10,
    },
    vault: {
      address: 'http://localhost:8200',
      token: 'root',
      transitKeyName: 'biometric-encryption',
      rotationIntervalDays: 90,
    },

    storyIngestion: {
      maxDecompositionTimeMs: 10000,
      maxShotsPerStory: 100, // Dynamic per EC-011
    },

    modelRegistry: {
      models: [],
      refreshIntervalMs: 300000, // 5 minutes
    },

    router: {
      systemDefaultPriority: ['veo3-low', 'veo3-high', 'runway-gen3', 'luma-ray2'],
      eligibilityCheckEnabled: true,
    },

    admission: {
      moderation: {
        provider: 'built-in',
        categories: ['violence', 'sexual_content', 'hate', 'pii', 'csam'],
        threshold: 0.8,
      },
      sacredGuard: {
        visualSimilarityThreshold: 0.775, // Mid-range of 0.75-0.80
        perModelThresholds: {
          'veo3-low': 0.78,
          'veo3-high': 0.77,
          'runway-gen3': 0.79,
          'luma-ray2': 0.80,
        },
      },
      costGuard: {
        perModelEstimates: {
          'veo3-low': 0.00,
          'veo3-high': 0.05, // $0.05/second
          'runway-gen3': 0.08, // $0.08/second
          'luma-ray2': 0.03, // $0.03/second
        },
        userBudgetUsd: 100.00,
        projectCeilingUsd: 500.00,
        committedSpendLimitUsd: 50.00,
        singleShotDriftThreshold: 0.50,
        rollingAverageDriftThreshold: 0.20,
      },
      rateLimit: {
        perModel: {
          'veo3-low': 10,
          'veo3-high': 5,
          'runway-gen3': 5,
          'luma-ray2': 20,
        },
        perUser: 20,
        global: 100,
        perProjectOverrides: {},
      },
      auditEnabled: true,
    },

    dispatch: {
      defaultTimeouts: {
        'veo3-low': 120,
        'veo3-high': 180,
        'runway-gen3': 180,
        'luma-ray2': 120,
      },
      watchdogPollIntervalMs: 30000,
      watchdogMaxWaitMs: 600000, // 10 minutes
      maxFallbackAttempts: 3,
    },

    faceLock: {
      perModelCharacterThresholds: {},
      defaultPerModelThresholds: {
        'veo3-low': 0.82,
        'veo3-high': 0.80,
        'runway-gen3': 0.85,
        'luma-ray2': 0.78,
      },
      maxRetries: 2,
      perModelCharacterRetries: {},
    },

    merger: {
      defaultTransition: {
        type: 'crossfade',
        durationSeconds: 0.5,
      },
      ffmpegPath: 'ffmpeg',
      supportedFormats: ['mp4'],
      maxMergeTimeMs: 300000,
    },

    observability: {
      metricsPort: 9090,
      healthCheckIntervalMs: 30000,
      auditRetentionYears: 7,
      alertmanager: {
        webhookUrl: process.env.ALERTMANAGER_WEBHOOK_URL || '',
      },
      archive: {
        backend: (process.env.ARCHIVE_BACKEND as 's3' | 'gcs' | 'local') || 'local',
        bucket: process.env.ARCHIVE_BUCKET || 'ai-video-fte-archive',
        localPath: process.env.ARCHIVE_LOCAL_PATH || './data/archive',
      },
    },
  };
}

function getEnvOverrides(): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {};

  // Postgres - check for host or secret file
  const pgHost = process.env.POSTGRES_HOST;
  const pgPassword = getSecret('POSTGRES_PASSWORD_FILE', 'postgres_password', 'POSTGRES_PASSWORD');
  if (pgHost || pgPassword) {
    overrides.postgres = {
      host: pgHost || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'ai_video_fte',
      user: process.env.POSTGRES_USER || 'postgres',
      password: pgPassword || 'postgres',
      ssl: process.env.POSTGRES_SSL === 'true',
      poolSize: parseInt(process.env.POSTGRES_POOL_SIZE || '20'),
    };
  }

  // Redis - check for host or secret file
  const redisHost = process.env.REDIS_HOST;
  const redisPassword = getSecret('REDIS_PASSWORD_FILE', 'redis_password', 'REDIS_PASSWORD');
  if (redisHost || redisPassword) {
    overrides.redis = {
      host: redisHost || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: redisPassword,
      db: parseInt(process.env.REDIS_DB || '0'),
      connectionPoolSize: parseInt(process.env.REDIS_POOL_SIZE || '10'),
    };
  }

  // Vault - check for address or secret file
  const vaultAddr = process.env.VAULT_ADDR;
  const vaultToken = getSecret('VAULT_TOKEN_FILE', 'vault_token', 'VAULT_TOKEN');
  if (vaultAddr || vaultToken) {
    overrides.vault = {
      address: vaultAddr || 'http://localhost:8200',
      token: vaultToken || 'root',
      transitKeyName: process.env.VAULT_TRANSIT_KEY || 'biometric-encryption',
      rotationIntervalDays: parseInt(process.env.VAULT_ROTATION_DAYS || '90'),
    };
  }

  // API Keys (loaded into config for adapter use) - support _FILE variants
  const elevenlabsKey = getSecret('ELEVENLABS_API_KEY_FILE', 'elevenlabs_key', 'ELEVENLABS_API_KEY');
  if (elevenlabsKey) {
    (overrides as any).elevenlabsApiKey = elevenlabsKey;
  }
  const veoKey = getSecret('VEO_API_KEY_FILE', 'veo_key', 'VEO_API_KEY');
  if (veoKey) {
    (overrides as any).veoApiKey = veoKey;
  }
  const runwayKey = getSecret('RUNWAY_API_KEY_FILE', 'runway_key', 'RUNWAY_API_KEY');
  if (runwayKey) {
    (overrides as any).runwayApiKey = runwayKey;
  }
  const lumaKey = getSecret('LUMA_API_KEY_FILE', 'luma_key', 'LUMA_API_KEY');
  if (lumaKey) {
    (overrides as any).lumaApiKey = lumaKey;
  }

  return overrides;
}

function mergeConfig(
  defaults: AppConfig,
  fileConfig: Partial<AppConfig>,
  envOverrides: Partial<AppConfig>
): AppConfig {
  return deepMerge(deepMerge(defaults, fileConfig), envOverrides);
}

function deepMerge(target: any, source: any): any {
  if (!source) return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export const config = loadConfig();