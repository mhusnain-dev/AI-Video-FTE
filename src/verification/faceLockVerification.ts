/**
 * Face-Lock Post-Generation Verification Service
 * Implements FR-024: Post-Generation Verification
 * Extracts frames from generated video, computes face embeddings,
 * compares against registered character references.
 */

import crypto from 'crypto';
import { config } from '../shared/config.js';
import { query } from '../shared/db.js';
import type { CharacterRegistryEntry, FaceLockVerificationResult, CompiledPrompt, ModelCapabilities, ShotPlan } from '../shared/types.js';
import { compilePrompt } from '../generation/promptCompiler.js';
import { dispatchShot } from '../dispatch/shotDispatcher.js';
import { emitShotStateChange } from '../shared/events.js';
// Metrics
import {
  facelockVerificationTotal,
  facelockSimilarityScore,
  facelockRegenerationTotal,
  facelockMaxRetriesExceededTotal,
  facelockCrossShotDriftDetectedTotal,
  facelockConsistencyReportGeneratedTotal,
} from '../shared/metrics.js';

// ============================================
// Video Frame Extraction (simplified - production would use FFmpeg)
// ============================================

export interface FrameExtractionResult {
  frames: FrameData[];
  extractionError?: string;
}

export interface FrameData {
  timestampSeconds: number;
  imageBase64: string; // Base64 encoded frame
  width: number;
  height: number;
}

/**
 * Extract frames from video at specified timestamps
 * In production, this would use FFmpeg to extract actual frames
 * For now, returns mock frames for development
 */
export async function extractFramesFromVideo(
  videoUrl: string,
  timestamps: number[],
  shotId: string
): Promise<FrameExtractionResult> {
  // In production:
  // 1. Download video from videoUrl (signed URL)
  // 2. Use FFmpeg to extract frames at specified timestamps
  // 3. Return base64 encoded frames

  // For development, return mock frames
  const frames: FrameData[] = timestamps.map(ts => ({
    timestampSeconds: ts,
    imageBase64: `mock-frame-${shotId}-${ts}`,
    width: 1920,
    height: 1080,
  }));

  return { frames };
}

/**
 * Generate timestamps for frame sampling
 * Samples at: 10%, 30%, 50%, 70%, 90% of duration
 */
export function getVerificationTimestamps(durationSeconds: number, maxFrames = 5): number[] {
  const timestamps: number[] = [];
  for (let i = 1; i <= maxFrames; i++) {
    const position = (i * 0.2) - 0.1; // 0.1, 0.3, 0.5, 0.7, 0.9
    timestamps.push(Math.max(0, Math.min(durationSeconds * position, durationSeconds - 0.1)));
  }
  return timestamps;
}

// ============================================
// Face Embedding Computation
// ============================================

/**
 * Compute face embedding from frame
 * In production, uses ArcFace or similar model via ONNX/TensorFlow
 */
export async function computeFaceEmbedding(
  frameBase64: string,
  characterName: string
): Promise<number[] | null> {
  // In production:
  // 1. Detect face in frame using face detection model
  // 2. Align face and compute 512-dim embedding using ArcFace
  // 3. Return normalized embedding vector

  // For development, return deterministic mock embedding based on character name
  const seed = crypto.createHash('sha256').update(`${characterName}-${frameBase64}`).digest('hex');
  const embedding = new Array(512).fill(0).map((_, i) => {
    const charCode = seed.charCodeAt(i % seed.length);
    return (charCode / 255) * 2 - 1;
  });

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

// ============================================
// Face Verification
// ============================================

/**
 * Verify a single character in a generated shot
 * Extracts frames, computes embeddings, compares with reference
 */
export async function verifyCharacterInShot(
  shotId: string,
  videoUrl: string,
  durationSeconds: number,
  character: CharacterRegistryEntry,
  modelId: string,
  retryCount: number = 0
): Promise<FaceLockVerificationResult> {
  // Get threshold for this model/character (CL-002)
  const faceLockConfig = config.faceLock;
  const threshold =
    faceLockConfig.perModelCharacterThresholds[modelId]?.[character.name] ||
    faceLockConfig.defaultPerModelThresholds[modelId] ||
    0.75;

  // Get reference embedding (decrypt from storage if encrypted)
  let referenceEmbedding: number[];
  try {
    // faceEmbedding is number[] in types - use directly
    // In production, if encrypted, decryptEmbeddingFromStorage would be used with DEK fetcher
    referenceEmbedding = character.faceEmbedding || [];
  } catch (error) {
    console.error(`Failed to decrypt reference embedding for character ${character.name}:`, error);
    return {
      characterName: character.name,
      shotId,
      similarity: 0,
      threshold,
      passed: false,
      retryCount,
      modelId,
    };
  }

  if (referenceEmbedding.length === 0) {
    console.warn(`No reference embedding for character ${character.name}, skipping verification`);
    return {
      characterName: character.name,
      shotId,
      similarity: 0,
      threshold,
      passed: false,
      retryCount,
      modelId,
    };
  }

  // Extract frames for verification
  const timestamps = getVerificationTimestamps(durationSeconds);
  const frameResult = await extractFramesFromVideo(videoUrl, timestamps, shotId);

  if (frameResult.frames.length === 0) {
    return {
      characterName: character.name,
      shotId,
      similarity: 0,
      threshold,
      passed: false,
      retryCount,
      modelId,
    };
  }

  // Compute embeddings for each frame and compare
  let maxSimilarity = 0;

  for (const frame of frameResult.frames) {
    const frameEmbedding = await computeFaceEmbedding(frame.imageBase64, character.name);
    if (frameEmbedding) {
      const similarity = cosineSimilarity(referenceEmbedding, frameEmbedding);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
  }

  const passed = maxSimilarity >= threshold;

  // Record metrics
  facelockVerificationTotal.inc({ character_name: character.name, model_id: modelId, result: passed ? 'passed' : 'failed' });
  facelockSimilarityScore.observe({ character_name: character.name, model_id: modelId }, maxSimilarity);

  return {
    characterName: character.name,
    shotId,
    similarity: maxSimilarity,
    threshold,
    passed,
    retryCount,
    modelId,
  };
}

/**
 * Verify all characters in a shot
 * Calls verifyCharacterInShot for each registered character in the shot
 */
export async function verifyShotCharacters(
  shotId: string,
  videoUrl: string,
  durationSeconds: number,
  characters: CharacterRegistryEntry[],
  modelId: string,
  retryCount: number = 0
): Promise<FaceLockVerificationResult[]> {
  const results: FaceLockVerificationResult[] = [];

  for (const character of characters) {
    const result = await verifyCharacterInShot(
      shotId,
      videoUrl,
      durationSeconds,
      character,
      modelId,
      retryCount
    );
    results.push(result);
  }

  return results;
}

/**
 * Store verification result in database
 */
export async function storeVerificationResult(
  result: FaceLockVerificationResult
): Promise<void> {
  await query(
    `INSERT INTO face_lock_verifications (shot_id, character_name, similarity, threshold, passed, retry_count, model_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      result.shotId,
      result.characterName,
      result.similarity,
      result.threshold,
      result.passed,
      result.retryCount,
      result.modelId,
    ]
  );
}

/**
 * Get verification results for a shot
 */
export async function getShotVerificationResults(shotId: string): Promise<FaceLockVerificationResult[]> {
  const result = await query(
    `SELECT * FROM face_lock_verifications WHERE shot_id = $1 ORDER BY created_at`,
    [shotId]
  );

  return result.rows.map(row => ({
    characterName: row.character_name,
    shotId: row.shot_id,
    similarity: row.similarity,
    threshold: row.threshold,
    passed: row.passed,
    retryCount: row.retry_count,
    modelId: row.model_id,
  }));
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================
// Face-Lock Auto-Regeneration Decision
// ============================================

export interface FaceLockRegenerationDecision {
  shouldRegenerate: boolean;
  reason: string;
  nextRetryCount: number;
  maxRetries: number;
}

/**
 * Determine if shot should be regenerated based on Face-Lock verification results
 * Implements FR-024: Verification failure triggers auto-regeneration (limited retries)
 */
export function shouldRegenerateShot(
  verificationResults: FaceLockVerificationResult[],
  maxRetries: number
): FaceLockRegenerationDecision {
  const failedResults = verificationResults.filter(r => !r.passed);

  if (failedResults.length === 0) {
    return {
      shouldRegenerate: false,
      reason: 'All characters passed Face-Lock verification',
      nextRetryCount: 0,
      maxRetries,
    };
  }

  const currentRetryCount = Math.max(...verificationResults.map(r => r.retryCount));
  const nextRetryCount = currentRetryCount + 1;

  if (nextRetryCount > maxRetries) {
    // Record max retries exceeded metric
    for (const failed of failedResults) {
      facelockMaxRetriesExceededTotal.inc({ character_name: failed.characterName, model_id: failed.modelId });
    }
    return {
      shouldRegenerate: false,
      reason: `Max retries (${maxRetries}) exceeded for Face-Lock verification`,
      nextRetryCount,
      maxRetries,
    };
  }

  const failedNames = failedResults.map(r => r.characterName).join(', ');
  return {
    shouldRegenerate: true,
    reason: `Face-Lock verification failed for: ${failedNames}. Retry ${nextRetryCount}/${maxRetries}`,
    nextRetryCount,
    maxRetries,
  };
}

// ============================================
// Cross-Shot Consistency Report (Task 39)
// ============================================

import type { CrossShotConsistencyReport, CharacterConsistencySummary, CharacterShotConsistency, CrossShotRecommendation } from '../shared/types.js';

/**
 * Generate cross-shot consistency report for a story
 * Aggregates per-character verification results across all shots
 * Implements FR-025, AC-019
 */
export async function generateCrossShotConsistencyReport(
  storyId: string
): Promise<CrossShotConsistencyReport> {
  // Get all shots for this story with their verification results
  const shotsResult = await query(
    `SELECT s.id as shot_id, s.order as shot_order, s.characters
     FROM shots s
     WHERE s.story_id = $1
     ORDER BY s.order`,
    [storyId]
  );

  if (shotsResult.rows.length === 0) {
    return {
      storyId,
      generatedAt: new Date(),
      totalCharacters: 0,
      totalShots: 0,
      characterSummaries: [],
      overallPassed: true,
      overallDriftDetected: false,
      recommendations: [],
    };
  }

  // Get all verification results for this story
  const verificationsResult = await query(
    `SELECT flv.*, s.order as shot_order
     FROM face_lock_verifications flv
     JOIN shots s ON flv.shot_id = s.id
     WHERE s.story_id = $1
     ORDER BY s.order, flv.character_name`,
    [storyId]
  );

  // Get unique character names from this story
  const characterNames = [...new Set(verificationsResult.rows.map(r => r.character_name))];

  const characterSummaries: CharacterConsistencySummary[] = [];

  for (const characterName of characterNames) {
    const charVerifications = verificationsResult.rows.filter(r => r.character_name === characterName);

    if (charVerifications.length === 0) continue;

    const shots: CharacterShotConsistency[] = charVerifications.map(v => ({
      shotId: v.shot_id,
      shotOrder: v.shot_order,
      similarity: v.similarity,
      threshold: v.threshold,
      passed: v.passed,
      retryCount: v.retry_count,
    }));

    const similarities = shots.map(s => s.similarity);
    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
      : 0;
    const minSimilarity = similarities.length > 0 ? Math.min(...similarities) : 0;
    const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
    const threshold = charVerifications[0].threshold;

    // Drift detected if similarity varies significantly (>0.15 range)
    const driftDetected = (maxSimilarity - minSimilarity) > 0.15;

    const verifiedShots = shots.filter(s => s.passed).length;
    const failedShots = shots.filter(s => !s.passed).length;

    characterSummaries.push({
      characterName,
      characterId: '',
      totalShots: shots.length,
      verifiedShots,
      failedShots,
      averageSimilarity: avgSimilarity,
      minSimilarity,
      maxSimilarity,
      threshold,
      driftDetected,
      shots,
    });
  }

  const overallPassed = characterSummaries.every(c => c.failedShots === 0);
  const overallDriftDetected = characterSummaries.some(c => c.driftDetected);

  // Generate recommendations
  const recommendations: CrossShotRecommendation[] = [];

  for (const summary of characterSummaries) {
    if (summary.failedShots > 0) {
      for (const shot of summary.shots.filter(s => !s.passed)) {
        recommendations.push({
          type: 'regen_shot',
          characterName: summary.characterName,
          shotId: shot.shotId,
          message: `Character "${summary.characterName}" failed Face-Lock in shot ${shot.shotOrder} (similarity: ${shot.similarity.toFixed(2)}, threshold: ${shot.threshold.toFixed(2)})`,
          priority: 'high',
        });
      }
    }
    if (summary.driftDetected) {
      recommendations.push({
        type: 'review_character',
        characterName: summary.characterName,
        message: `Character "${summary.characterName}" shows visual drift across shots (range: ${summary.minSimilarity.toFixed(2)} - ${summary.maxSimilarity.toFixed(2)})`,
        priority: 'medium',
      });
    }
    if (summary.averageSimilarity < summary.threshold + 0.05) {
      recommendations.push({
        type: 'adjust_threshold',
        characterName: summary.characterName,
        message: `Character "${summary.characterName}" average similarity (${summary.averageSimilarity.toFixed(2)}) is close to threshold (${summary.threshold.toFixed(2)})`,
        priority: 'low',
      });
    }
  }

  return {
    storyId,
    generatedAt: new Date(),
    totalCharacters: characterSummaries.length,
    totalShots: shotsResult.rows.length,
    characterSummaries,
    overallPassed,
    overallDriftDetected,
    recommendations,
  };
}

/**
 * Generate lightweight story Face-Lock summary (for dashboard/events)
 */
export async function generateStoryFaceLockSummary(
  storyId: string
): Promise<import('../shared/types.js').StoryFaceLockSummary> {
  const report = await generateCrossShotConsistencyReport(storyId);

  const charactersPassed = report.characterSummaries.filter(c => c.failedShots === 0).length;
  const charactersFailed = report.characterSummaries.filter(c => c.failedShots > 0).length;

  const allSimilarities = report.characterSummaries.flatMap(c =>
    c.shots.map(s => s.similarity)
  );
  const avgSimilarity = allSimilarities.length > 0
    ? allSimilarities.reduce((sum, s) => sum + s, 0) / allSimilarities.length
    : 0;

  let overallStatus: 'passed' | 'partial' | 'failed' = 'passed';
  if (charactersFailed > 0 && charactersPassed > 0) overallStatus = 'partial';
  else if (charactersFailed > 0) overallStatus = 'failed';

  return {
    storyId,
    totalCharacters: report.totalCharacters,
    totalShots: report.totalShots,
    overallStatus,
    charactersPassed,
    charactersFailed,
    avgSimilarity,
    driftDetected: report.overallDriftDetected,
    completedAt: new Date(),
  };
}

/**
 * Trigger Face-Lock regeneration for a failed shot
 * Re-compiles prompt with incremented retryCount and dispatches to same model
 * This is called from webhookHandler when Face-Lock verification fails
 */
export async function triggerFaceLockRegeneration(
  shotId: string,
  characters: CharacterRegistryEntry[],
  modelId: string,
  retryCount: number
): Promise<void> {
  try {
    // Get shot details
    const shotResult = await query(
      `SELECT * FROM shots WHERE id = $1`,
      [shotId]
    );

    if (shotResult.rows.length === 0) {
      console.error(`Shot ${shotId} not found for Face-Lock regeneration`);
      return;
    }

    const shot = shotResult.rows[0] as ShotPlan;

    // Get model capabilities
    const { getModelRegistry } = await import('../router/modelRegistry.js');
    const capabilities = await getModelRegistry();
    const model = capabilities.find(m => m.id === modelId);

    if (!model) {
      console.error(`Model ${modelId} not found for Face-Lock regeneration`);
      return;
    }

    // Re-compile prompt with updated retryCount
    // The promptCompiler will use the retryCount for maxRetries in FaceLockConditioning
    const compiledPrompt = await compilePrompt(shot, characters, model, {
      maxPromptLength: 4000,
      retryCount,
    });

    // Dispatch with same model (not fallback) with retryCount
    const dispatchResult = await dispatchShot(shot, compiledPrompt, model, {
      skipAdmission: true, // Already passed admission
    });

    if (!dispatchResult.success) {
      console.error(`Face-Lock regeneration dispatch failed for shot ${shotId}: ${dispatchResult.error}`);
      // Update shot status to failed
      await query(
        `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [shotId, `Face-Lock regeneration dispatch failed: ${dispatchResult.error}`]
      );
      await emitShotStateChange(shotId, 'face_lock_failed', 'failed', 'regeneration_dispatch_failed', {
        error: dispatchResult.error,
        retryCount,
      });
      return;
    }

    console.log(`Face-Lock regeneration dispatched for shot ${shotId} (retry ${retryCount})`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown regeneration error';
    console.error(`Face-Lock regeneration error for shot ${shotId}:`, errorMessage);

    // Update shot status to failed
    await query(
      `UPDATE shots SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [shotId, `Face-Lock regeneration error: ${errorMessage}`]
    );
    await emitShotStateChange(shotId, 'face_lock_failed', 'failed', 'regeneration_error', {
      error: errorMessage,
      retryCount,
    });
  }
}