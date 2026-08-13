/**
 * Shared types - Re-exports from backend @shared/types
 * Single source of truth for type definitions
 */

// Story & Shot Types
export type StoryStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'approved'
  | 'in_progress'
  | 'generating'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused_cost'
  | 'paused_rate_limit'
  | 'paused_sacred_guard';

export type ShotStatus =
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'in_admission'
  | 'admission_passed'
  | 'dispatched'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'regenerating';

export interface StoryBrief {
  narrative: string;
  targetDurationSeconds: number;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
  resolution?: '720p' | '1080p' | '4K';
  characterReferences?: string[];
  styleReferences?: string[];
  negativePrompts?: string[];
  audioConfig?: AudioConfig;
}

export interface AudioConfig {
  ttsVoice?: string;
  ttsStyle?: string;
  musicSource?: 'royalty_free' | 'elevenlabs' | 'custom';
  musicTrackId?: string;
  musicVolume?: number;
}

export interface CreateStoryRequest {
  brief: StoryBrief;
  userId: string;
}

export interface Story {
  id: string;
  userId: string;
  brief: StoryBrief;
  status: StoryStatus;
  shotPlan?: Shot[];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  costEstimateUsd?: number;
  costActualUsd?: number;
}

export interface Shot {
  id: string;
  storyId: string;
  orderIndex: number;
  visualDescription: string;
  durationSeconds: number;
  cameraMotion?: string;
  characterNames?: string[];
  keyObjects?: string[];
  keyActions?: string[];
  audioCues?: string[];
  transition?: TransitionConfig;
  modelOverride?: string;
  status: ShotStatus;
  compiledPrompt?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  generationProgress?: number;
  generationResult?: GenerationResult;
  faceLockResults?: FaceLockResult[];
  admissionResult?: AdmissionResult;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionConfig {
  type: 'crossfade' | 'fade' | 'slide' | 'zoom' | 'wipe' | 'custom';
  durationSeconds: number;
  ffmpegFilter?: string;
}

export interface GenerationResult {
  videoUrl: string;
  thumbnailUrl?: string;
  modelUsed: string;
  generationTimeMs: number;
  costUsd: number;
  metadata?: Record<string, unknown>;
}

export interface AdmissionResult {
  passed: boolean;
  moderation: GateResult;
  sacredGuard: GateResult;
  costGuard: GateResult;
  rateLimit: GateResult;
  details: Record<string, unknown>;
}

export interface GateResult {
  passed: boolean;
  reason?: string;
  score?: number;
  threshold?: number;
  matchType?: 'exact' | 'fuzzy' | 'visual';
  details?: Record<string, unknown>;
}

export interface FaceLockResult {
  characterName: string;
  model: string;
  similarityScore: number;
  threshold: number;
  passed: boolean;
  retryCount: number;
  autoRegenerated?: boolean;
  verificationFrames?: string[];
  referenceFrame?: string;
}

export interface ShotPlanRevision {
  action: 'add' | 'remove' | 'reorder' | 'edit';
  shotId?: string;
  newOrder?: number;
  shotData?: Partial<Shot>;
}

// Character Types
export interface CharacterReference {
  id: string;
  storyId: string;
  name: string;
  imageBase64: string;
  voiceReferenceBase64?: string;
  faceEmbedding?: number[];
  faceDetected: boolean;
  sacredGuardPassed: boolean;
  sacredGuardScore?: number;
  encrypted: boolean;
  createdAt: string;
}

// Model Types
export interface ModelConfig {
  id: string;
  name: string;
  provider: 'veo3' | 'runway' | 'luma' | 'custom';
  maxDurationSeconds: number;
  costPerSecondUsd: number;
  rateLimitPerMinute: number;
  capabilities: string[];
  eligible: boolean;
}

export interface UserModelPriority {
  userId: string;
  priorityList: string[]; // Model IDs in priority order
  useSystemDefault: boolean;
}

// Delivery Types
export interface DeliveryPackage {
  id: string;
  storyId: string;
  videoUrl: string;
  signedUrl?: string;
  signedUrlExpiresAt?: string;
  format: 'mp4';
  resolution: string;
  durationSeconds: number;
  fileSizeBytes: number;
  subtitles?: SubtitleInfo;
  costBreakdown: CostBreakdown;
  verificationReports: VerificationReports;
  transitionTimeline: TransitionTimelineEntry[];
  createdAt: string;
}

export interface SubtitleInfo {
  srtUrl?: string;
  vttUrl?: string;
  assUrl?: string;
  languages: string[];
}

export interface CostBreakdown {
  totalEstimatedUsd: number;
  totalActualUsd: number;
  perShot: ShotCost[];
  budgetUsedPercentage: number;
  driftAlerts: DriftAlert[];
}

export interface ShotCost {
  shotId: string;
  model: string;
  estimatedUsd: number;
  actualUsd: number;
  driftPercentage: number;
}

export interface DriftAlert {
  shotId: string;
  type: 'single_shot' | 'rolling_average';
  threshold: number;
  actual: number;
}

export interface VerificationReports {
  faceLock: FaceLockReport[];
  crossShotConsistency: CrossShotConsistencyReport;
  sacredGuard: SacredGuardAuditEntry[];
}

export interface FaceLockReport {
  shotId: string;
  characterName: string;
  model: string;
  similarityScore: number;
  threshold: number;
  passed: boolean;
  retries: number;
  autoRegenerated: boolean;
}

export interface CrossShotConsistencyReport {
  characterName: string;
  referenceEmbedding: string;
  shotScores: { shotId: string; score: number }[];
  overallPassed: boolean;
}

export interface SacredGuardAuditEntry {
  shotId: string;
  trigger: 'exact_match' | 'fuzzy_match' | 'visual_similarity';
  matchedReference: string;
  similarityScore: number;
  threshold: number;
  action: 'blocked' | 'flagged' | 'approved';
  timestamp: string;
}

export interface TransitionTimelineEntry {
  shotId: string;
  transition: TransitionConfig;
  startTime: number;
  endTime: number;
  thumbnailUrl?: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// SSE Event Types
export interface StateChangeEvent {
  type: 'story_status' | 'shot_status' | 'admission_result' | 'generation_progress' | 'face_lock_result' | 'merge_progress' | 'delivery_ready' | 'cost_update' | 'error' | 'alert';
  traceId: string;
  storyId: string;
  shotId?: string;
  timestamp: string;
  payload: Record<string, any>;
}

export interface StreamMessage {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}