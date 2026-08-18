/**
 * Core shared types for AI Video Production Specialist FTE
 * Maps to FR-001 through FR-034, NFR-001 through NFR-008
 */

// ============================================
// Story & Shot Types (FR-001, FR-002, FR-003, FR-004)
// ============================================

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type Resolution = '720p' | '1080p' | '4K';

export type QualityPreset =
  | 'draft'
  | 'standard'
  | 'high'
  | 'ultra_realistic';

export interface QualityPresetConfig {
  quality: QualityPreset;
  costMultiplier: number;
  maxResolution: Resolution;
  maxRetries: number;
  faceLockThreshold: number;
}

export type TransitionType =
  | 'crossfade'
  | 'fade'
  | 'slide'
  | 'zoom'
  | 'wipe'
  | string; // Any FFmpeg filter

export interface TransitionConfig {
  type: TransitionType;
  durationSeconds: number;
}

export interface StoryBrief {
  narrative: string;
  targetDurationSeconds: number;
  aspectRatio?: AspectRatio; // default: '16:9'
  resolution?: Resolution; // default: '1080p' (CL-015)
  characterReferences?: CharacterReference[];
  styleReferences?: string[];
  negativePrompts?: string[];
  transition?: TransitionConfig; // default: crossfade 0.5s (CL-014, CL-020)
  audioConfig?: AudioConfig; // TTS + music config (CL-013, CL-022)
}

export interface CharacterReference {
  name: string;
  imageBase64: string; // Base64 encoded image
  voiceReferenceBase64?: string; // Optional voice sample
}

export interface ShotPlan {
  id: string;
  storyId: string;
  order: number;
  visualDescription: string;
  durationSeconds: number;
  cameraMotion: string;
  characters: string[]; // Character names from registry
  keyObjects: string[];
  keyActions: string[];
  audioCues?: string[];
  styleReferences?: string[];
  negativePrompts?: string[];
  modelOverride?: string; // Manual model pin (FR-008)
  transition?: TransitionConfig; // Per-shot override (FR-027)
  status: ShotStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type ShotStatus =
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'in_admission'
  | 'admission_passed'
  | 'admission_failed'
  | 'dispatched'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'face_lock_failed'
  | 'timeout';

export interface Story {
  id: string;
  userId: string;
  brief: StoryBrief;
  shots: ShotPlan[];
  status: StoryStatus;
  aspectRatio: AspectRatio;
  targetDurationSeconds: number;
  resolution: Resolution;
  globalTransition?: TransitionConfig;
  audioConfig?: AudioConfig;
  totalEstimatedCost: number;
  totalActualCost: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ShotPlanRevision {
  shotId?: string; // If updating existing
  action: 'add' | 'remove' | 'reorder' | 'edit';
  shotData?: Partial<ShotPlan> & { order?: number };
  newOrder?: number;
}

export type StoryStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'approved'
  | 'in_progress'
  | 'generating'
  | 'pending_merge'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused_cost'
  | 'paused_rate_limit'
  | 'paused_sacred_guard';

// ============================================
// Model & Routing Types (FR-005, FR-006, FR-007, FR-008)
// ============================================

export interface ModelCapabilities {
  id: string;
  name: string;
  provider: string;
  maxResolution: Resolution;
  maxDurationSeconds: number;
  supportedAspectRatios: AspectRatio[];
  supportedRegions: string[];
  costPerSecondUsd: number; // 0 for free tiers (e.g., Veo 3 low quality)
  costCurrency: string;
  capabilities: ModelCapability[];
  defaultTimeoutSeconds: number;
}

export type ModelCapability =
  | 'text_to_video'
  | 'image_to_video'
  | 'reference_conditioning'
  | 'native_audio'
  | 'high_fidelity'
  | 'fast_generation';

export interface ModelPriorityConfig {
  userId: string;
  priorityList: string[]; // Model IDs in priority order
  updatedAt: Date;
}

export interface SystemDefaultModelPriority {
  priorityList: string[]; // System default when user unconfigured
  updatedAt: Date;
}

// ============================================
// Admission Control Types (FR-009 through FR-015)
// ============================================

export type AdmissionGate = 'moderation' | 'sacred_guard' | 'cost_guard' | 'rate_limit';

export type AdmissionDecision = 'pass' | 'fail' | 'warn';

export interface AdmissionContext {
  storyId: string;
  shotId: string;
  prompt: string;
  referenceImages: string[]; // Base64
  modelId: string;
  userId: string;
  estimatedCost: number;
}

export interface AdmissionResult {
  gate: AdmissionGate;
  decision: AdmissionDecision;
  reason?: string;
  category?: string;
  ruleTriggered?: string;
  context: AdmissionContext;
  timestamp: Date;
}

export interface AdmissionAuditEntry {
  id: string;
  storyId: string;
  shotId: string;
  gate: AdmissionGate;
  decision: AdmissionDecision;
  reason?: string;
  category?: string;
  ruleTriggered?: string;
  fullContext: Record<string, unknown>;
  timestamp: Date;
}

// Sacred Guard specific types (FR-011, FR-012, CON-001, CON-002)
export interface SacredGuardConfig {
  visualSimilarityThreshold: number; // 0.75-0.80 cosine similarity default
  perModelThresholds: Record<string, number>; // modelId -> threshold
}

export interface SacredGuardMatch {
  matchType: 'exact' | 'transliterated' | 'fuzzy' | 'visual_semantic';
  matchedEntity: string;
  confidence: number;
  enforcementPoint: 'creation' | 'registry' | 'moderation' | 'pre_dispatch' | 'post_generation_audit';
}

// Cost Guard specific types (FR-013, CL-010, CL-011)
export interface CostGuardConfig {
  perModelEstimates: Record<string, number>; // modelId -> cost per second USD
  userBudgetUsd: number;
  projectCeilingUsd: number;
  committedSpendLimitUsd: number;
  singleShotDriftThreshold: number; // default 0.5 (50%)
  rollingAverageDriftThreshold: number; // default 0.2 (20%)
}

export interface CostGuardOverrunOptions {
  reduceScope: boolean;
  increaseBudget: boolean;
  cancel: boolean;
}

// Rate Limit specific types (FR-014, CL-012)
export interface RateLimitConfig {
  perModel: Record<string, number>; // modelId -> requests per minute
  perUser: number; // default 20/min
  global: number; // default 100/min
  perProjectOverrides: Record<string, RateLimitConfig>;
}

// ============================================
// Face-Lock Types (FR-022 through FR-026, CON-003)
// ============================================

export interface CharacterRegistryEntry {
  id: string;
  userId: string;
  storyId: string;
  name: string;
  faceEmbedding: number[]; // Encrypted at rest (ArcFace 512-dim)
  voiceEmbedding?: number[]; // Encrypted at rest (ECAPA-TDNN 256-dim)
  referenceImageHash: string; // For deduplication (SHA-256)
  referenceImageBase64?: string; // Base64 encoded reference image for Face-Lock conditioning
  referenceImageUrl?: string; // Optional: URL to object storage (S3/GCS)
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FaceLockConfig {
  perModelCharacterThresholds: Record<string, Record<string, number>>; // modelId -> characterName -> threshold
  defaultPerModelThresholds: Record<string, number>; // modelId -> threshold
  maxRetries: number; // default 2
  perModelCharacterRetries: Record<string, Record<string, number>>;
}

export interface FaceLockVerificationResult {
  characterName: string;
  shotId: string;
  similarity: number;
  threshold: number;
  passed: boolean;
  retryCount: number;
  modelId: string;
}

/**
 * Face-Lock Conditioning for a single character in a shot
 * Used during prompt compilation to provide model-specific identity conditioning parameters
 */
export interface FaceLockConditioning {
  characterId: string;
  characterName: string;
  referenceImageBase64: string;
  identityStrength: number; // 0.0-1.0
  consistencyThreshold: number; // 0.0-1.0
  maxRetries: number;
  modelSpecificParams: Record<string, unknown>;
}

/**
 * Multi-character Face-Lock conditioning array
 * Replaces single faceLockConditioning in CompiledPrompt for multi-char support (Task 40)
 */
export interface MultiFaceLockConditioning {
  characterConditionings: FaceLockConditioning[];
  primaryCharacterId: string; // For models that only support single reference
}

/**
 * Model capability for multi-character Face-Lock support
 */
export interface ModelMultiCharacterCapability {
  modelId: string;
  supportsMultiCharacter: boolean;
  maxCharacters: number; // 1 = single only, >1 = multi-char supported
  compositingStrategy?: 'array' | 'composite' | 'sequential'; // How multiple refs are handled
}

/**
 * Cross-shot consistency summary for a single character across all shots
 */
export interface CharacterConsistencySummary {
  characterName: string;
  characterId: string;
  totalShots: number;
  verifiedShots: number;
  failedShots: number;
  averageSimilarity: number;
  minSimilarity: number;
  maxSimilarity: number;
  threshold: number;
  driftDetected: boolean; // True if similarity varies significantly across shots
  shots: CharacterShotConsistency[];
}

export interface CharacterShotConsistency {
  shotId: string;
  shotOrder: number;
  similarity: number;
  threshold: number;
  passed: boolean;
  retryCount: number;
}

/**
 * Story-level cross-shot Face-Lock consistency report (Task 39)
 */
export interface CrossShotConsistencyReport {
  storyId: string;
  generatedAt: Date;
  totalCharacters: number;
  totalShots: number;
  characterSummaries: CharacterConsistencySummary[];
  overallPassed: boolean; // All characters passed in all shots
  overallDriftDetected: boolean; // Any character shows drift
  recommendations: CrossShotRecommendation[];
}

export interface CrossShotRecommendation {
  type: 'regen_shot' | 'review_character' | 'adjust_threshold' | 'info';
  characterName?: string;
  shotId?: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Face-Lock summary for a story (lightweight, for dashboard/events)
 */
export interface StoryFaceLockSummary {
  storyId: string;
  totalCharacters: number;
  totalShots: number;
  overallStatus: 'passed' | 'partial' | 'failed';
  charactersPassed: number;
  charactersFailed: number;
  avgSimilarity: number;
  driftDetected: boolean;
  completedAt: Date;
}

// ============================================
// Generation & Dispatch Types (FR-016 through FR-021)
// ============================================

export interface CompiledPrompt {
  /** Model ID used for this compilation (for dispatch routing) */
  modelId: string;
  shotId: string;
  prompt: string;
  negativePrompt?: string;
  /** Per-character Face-Lock conditioning for multi-character shots (Task 40) */
  characterConditioning: CharacterConditioning[];
  /** Style reference images */
  styleReferences: string[];
  /** Model-specific parameters (also aliased as `parameters` for backward compat) */
  modelParams: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface CharacterConditioning {
  characterName: string;
  referenceImageBase64: string;
  modelSpecificParams: Record<string, unknown>;
}

export interface DispatchRecord {
  id: string;
  shotId: string;
  modelId: string;
  providerRequestId?: string;
  status: 'pending' | 'dispatched' | 'completed' | 'failed' | 'timeout' | 'fallback';
  dispatchedAt: Date;
  completedAt?: Date;
  error?: string;
  fallbackFromDispatchId?: string;
  webhookReceivedAt?: Date;
  webhookPayload?: any;
}

export interface GenerationResult {
  shotId: string;
  videoUrl: string;
  videoBase64?: string;
  durationSeconds: number;
  actualCost: number;
  modelId: string;
  providerMetadata: Record<string, unknown>;
  nativeAudioUrl?: string;
}

export interface WebhookPayload {
  provider: string;
  requestId: string;
  status: 'completed' | 'failed';
  result?: GenerationResult;
  error?: string;
  timestamp: Date;
  signature: string; // HMAC for idempotency
}

// ============================================
// Video Assembly Types (FR-027 through FR-030)
// ============================================

export interface AudioConfig {
  useNativeAudio: boolean;
  ttsConfig?: TTSConfig;
  musicConfig?: MusicConfig;
  customAudioAssets?: string[]; // User-provided audio URLs
}

export interface TTSConfig {
  provider: 'elevenlabs'; // Extensible
  voiceId: string; // e.g., 'shivank'
  style: string; // e.g., 'deep breath', 'suspense'
  text: string;
}

export interface MusicConfig {
  source: 'royalty_free' | 'elevenlabs' | 'custom';
  trackId?: string;
  volume?: number; // 0-1
}

export interface DeliveryPackage {
  storyId: string;
  videoUrl: string; // Signed URL with 7-day TTL
  resolution: Resolution;
  format: 'mp4';
  subtitles?: SubtitlePackage;
  metadata: StoryMetadata;
  costSummary: CostSummary;
  logs: GenerationLog[];
  verificationReports: VerificationReport[];
  expiresAt: Date;
}

export interface SubtitlePackage {
  format: 'srt' | 'vtt' | 'ass'; // default: srt
  content: string;
  language: string;
}

export interface StoryMetadata {
  title?: string;
  description?: string;
  tags: string[];
  createdAt: Date;
  completedAt: Date;
  modelUsed: string[];
  totalShots: number;
  successfulShots: number;
}

export interface CostSummary {
  totalEstimated: number;
  totalActual: number;
  driftPercentage: number;
  perShot: ShotCost[];
  currency: string;
}

export interface ShotCost {
  shotId: string;
  estimated: number;
  actual: number;
  modelId: string;
}

export interface GenerationLog {
  timestamp: Date;
  stage: string;
  shotId?: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
}

export interface VerificationReport {
  shotId: string;
  faceLockResults: FaceLockVerificationResult[];
  sacredGuardPostAudit: SacredGuardMatch[];
  passed: boolean;
}

// ============================================
// Observability Types (FR-031 through FR-034)
// ============================================

export interface StreamMessage {
  id: string;
  stream: string;
  data: Record<string, string>;
}

export interface StateChangeEvent {
  id: string;
  entityType: 'story' | 'shot' | 'character';
  entityId: string;
  fromState: string;
  toState: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  /** Root trace identifier for distributed tracing (generated at story creation) */
  traceId?: string;
  /** Current span identifier */
  spanId?: string;
  /** Parent span identifier for child operations */
  parentSpanId?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  metrics: {
    processingBacklog: number;
    avgLatencyMs: number;
    errorRate: number;
    costDriftPercentage: number;
    activeStories: number;
    activeShots: number;
  };
  checks: Record<string, ComponentHealth>;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
}

// ============================================
// Configuration Types (CL-001 through CL-023)
// ============================================

export interface AppConfig {
  // Phase 0
  postgres: PostgresConfig;
  redis: RedisConfig;
  vault: VaultConfig;

  // Phase 1
  storyIngestion: StoryIngestionConfig;

  // Phase 2
  modelRegistry: ModelRegistryConfig;
  router: RouterConfig;

  // Phase 3
  admission: AdmissionConfig;

  // Phase 4
  dispatch: DispatchConfig;

  // Phase 5
  faceLock: FaceLockConfig;

  // Phase 6
  merger: MergerConfig;

  // Phase 7
  observability: ObservabilityConfig;

  // Provider API keys (loaded from _FILE env vars, /run/secrets/, ./secrets/, or plain env vars)
  veoApiKey?: string;
  runwayApiKey?: string;
  lumaApiKey?: string;
  elevenlabsApiKey?: string;
  kieApiKey?: string;
  llmApiKey?: string;

  // Quality presets
  qualityPresets?: Record<QualityPreset, QualityPresetConfig>;

  // Auth
  jwtSecret?: string;
  jwtExpiryHours?: number;

  // Admin Account Management
  adminEmail?: string;
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    fromEmail: string;
  };
  frontendUrl?: string;
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolSize: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  connectionPoolSize: number;
}

export interface VaultConfig {
  address: string;
  token: string;
  transitKeyName: string;
  rotationIntervalDays: number; // default 90
}

export interface StoryIngestionConfig {
  maxDecompositionTimeMs: number; // default 10000 (10s)
  maxShotsPerStory: number; // calculated dynamically per EC-011
}

export interface ModelRegistryConfig {
  models: ModelCapabilities[];
  refreshIntervalMs: number;
}

export interface RouterConfig {
  systemDefaultPriority: string[];
  eligibilityCheckEnabled: boolean;
}

export interface AdmissionConfig {
  moderation: ModerationConfig;
  sacredGuard: SacredGuardConfig;
  costGuard: CostGuardConfig;
  rateLimit: RateLimitConfig;
  auditEnabled: boolean;
}

export interface ModerationConfig {
  provider: string;
  categories: string[];
  threshold: number;
}

export interface DispatchConfig {
  defaultTimeouts: Record<string, number>; // modelId -> seconds
  watchdogPollIntervalMs: number; // default 30000
  watchdogMaxWaitMs: number; // default 600000 (10 min)
  maxFallbackAttempts: number;
}

export interface MergerConfig {
  defaultTransition: TransitionConfig; // default 0.5s crossfade
  ffmpegPath: string;
  supportedFormats: string[];
  maxMergeTimeMs: number;
}

export interface ObservabilityConfig {
  metricsPort: number;
  healthCheckIntervalMs: number;
  auditRetentionYears: number; // default 7
  alertmanager?: AlertmanagerConfig;
  archive?: ArchiveConfig;
  logging?: LoggingConfig;
}

export interface AlertmanagerConfig {
  webhookUrl: string;
}

export interface ArchiveConfig {
  backend: 's3' | 'gcs' | 'local';
  bucket: string;
  localPath?: string;
}

export interface LoggingConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  prettyPrint?: boolean;
  redactPaths?: string[]; // Paths to redact in logs (e.g., ['password', 'token'])
}

// ============================================
// Prompt Sanitizer Types (F1)
// ============================================

export interface ModelConstraints {
  modelId: string;
  maxLength?: number;
  forbiddenPatterns?: string[];
  requiredSafetyInstructions?: string[];
}

export interface SanitizedPrompt {
  sanitized: string;
  piiFound: boolean;
  injectionsFound: boolean;
  warnings: string[];
}

// ============================================
// User Feedback Types (F7)
// ============================================

export interface UserFeedback {
  id: string;
  userId: string;
  storyId: string;
  shotId?: string;
  rating?: number;
  flagReason?: string;
  flagComment?: string;
  createdAt: Date;
}

// ============================================
// User Preferences Types (F8)
// ============================================

export interface UserPreferences {
  id: string;
  userId: string;
  preferences: UserPreferenceData;
  updatedAt: Date;
}

export interface UserPreferenceData {
  preferredModel?: string;
  preferredQuality?: QualityPreset;
  preferredTransitions?: string[];
  preferredAspectRatio?: AspectRatio;
  preferredResolution?: Resolution;
  costBudgetUsd?: number;
  faceLockThreshold?: number;
  learnedFromFeedback?: boolean;
  lastExtractedAt?: Date;
}

// ============================================
// User Settings Types (F10)
// ============================================

export interface UserSettings {
  id: string;
  userId: string;
  settings: UserSettingsData;
  updatedAt: Date;
}

export interface UserSettingsData {
  costLimits?: {
    perStoryUsd?: number;
    perMonthUsd?: number;
  };
  rateLimits?: {
    requestsPerMinute?: number;
  };
  faceLockThreshold?: number;
  defaultModel?: string;
  defaultQuality?: QualityPreset;
  defaultAspectRatio?: AspectRatio;
  defaultResolution?: Resolution;
  transitions?: TransitionConfig;
  audio?: AudioConfig;
  videoPreferences?: {
    fps?: number;
    enableSubtitles?: boolean;
  };
}