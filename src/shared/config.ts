/**
 * Configuration loader for AI Video FTE
 * Implements CL-001 through CL-023 configurable defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import 'dotenv/config';
import { AppConfig } from './types.js';

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
  // 3. Check local ./secrets directory (dev convenience - matches secret file names)
  const localPath = path.join(process.cwd(), 'secrets', `${secretName}.txt`);
  const localValue = readSecretFile(localPath);
  if (localValue) return localValue;
  // 4. Fall back to regular environment variable
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
      systemDefaultPriority: ['kie-veo3-fast', 'kie-veo3-quality', 'kie-veo3-lite', 'runway-gen3'],
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
          'kie-veo3-fast': 0.78,
          'kie-veo3-quality': 0.77,
          'kie-veo3-lite': 0.79,
          'runway-gen3': 0.79,
        },
      },
      costGuard: {
        perModelEstimates: {
          'kie-veo3-fast': 0.01,
          'kie-veo3-quality': 0.04,
          'kie-veo3-lite': 0.005,
          'runway-gen3': 0.08, // $0.08/second
        },
        userBudgetUsd: 100.00,
        projectCeilingUsd: 500.00,
        committedSpendLimitUsd: 50.00,
        singleShotDriftThreshold: 0.50,
        rollingAverageDriftThreshold: 0.20,
      },
      rateLimit: {
        perModel: {
          'kie-veo3-fast': 10,
          'kie-veo3-quality': 5,
          'kie-veo3-lite': 20,
          'runway-gen3': 5,
        },
        perUser: 20,
        global: 100,
        perProjectOverrides: {},
      },
      auditEnabled: true,
    },

    dispatch: {
      defaultTimeouts: {
        'kie-veo3-fast': 120,
        'kie-veo3-quality': 180,
        'kie-veo3-lite': 120,
        'runway-gen3': 180,
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

    adminEmail: '',
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      user: '',
      pass: '',
      fromEmail: 'noreply@example.com',
    },
    frontendUrl: 'http://localhost:5173',
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
    overrides.elevenlabsApiKey = elevenlabsKey;
  }
  const veoKey = getSecret('VEO_API_KEY_FILE', 'veo_key', 'VEO_API_KEY');
  if (veoKey) {
    overrides.veoApiKey = veoKey;
  }
  const runwayKey = getSecret('RUNWAY_API_KEY_FILE', 'runway_key', 'RUNWAY_API_KEY');
  if (runwayKey) {
    overrides.runwayApiKey = runwayKey;
  }
  const kieKey = getSecret('KIE_API_KEY_FILE', 'kie_key', 'KIE_API_KEY');
  if (kieKey) {
    overrides.kieApiKey = kieKey;
  }
  const llmKey = getSecret('LLM_API_KEY_FILE', 'llm_api_key', 'LLM_API_KEY');
  if (llmKey) {
    overrides.llmApiKey = llmKey;
  }

  // Admin email
  if (process.env.ADMIN_EMAIL) {
    overrides.adminEmail = process.env.ADMIN_EMAIL;
  }

  // SMTP config from secrets/smtp.txt
  const smtpLines = readSecretFile(path.join(process.cwd(), 'secrets', 'smtp.txt'));
  if (smtpLines) {
    const lines = smtpLines.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (lines.length >= 5) {
      overrides.smtp = {
        host: lines[0],
        port: parseInt(lines[1]),
        user: lines[2],
        pass: lines[3],
        fromEmail: lines[4],
      };
    }
  }

  // Frontend URL
  if (process.env.FRONTEND_URL) {
    overrides.frontendUrl = process.env.FRONTEND_URL;
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