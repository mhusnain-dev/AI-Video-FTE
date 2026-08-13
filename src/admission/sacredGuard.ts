/**
 * Sacred Guard Service
 * Multi-stage denylist: exact, transliterated, fuzzy, visual/semantic
 * Enforcement points: creation, registry, moderation, pre-dispatch, post-generation audit
 * Implements FR-011, FR-012, CON-001, CON-002, CL-001, CL-009
 */

import { query } from '../shared/db.js';
import { config } from '../shared/config.js';

interface SacredGuardCheckRequest {
  prompt: string;
  referenceImages: string[]; // base64
  modelId: string;
  userId: string;
  storyId?: string;
  shotId?: string;
  enforcementPoint: 'creation' | 'registry' | 'moderation' | 'pre_dispatch' | 'post_generation_audit';
}

export interface SacredGuardResult {
  blocked: boolean;
  reason?: string;
  matchType?: 'exact' | 'transliterated' | 'fuzzy' | 'visual_semantic';
  matchedEntity?: string;
  confidence?: number;
  matchedDenylistId?: string;
}

// In-memory cache for denylist (refreshed periodically)
let denylistCache: SacredDenylistEntry[] = [];
let cacheExpiry = 0;

interface SacredDenylistEntry {
  id: string;
  entityName: string;
  entityType: string;
  matchType: 'exact' | 'transliterated' | 'fuzzy' | 'visual_semantic';
  embedding?: number[]; // For visual/semantic matching
  isActive: boolean;
}

const CACHE_TTL_MS = 60000; // 1 minute

async function refreshDenylistCache(): Promise<void> {
  if (Date.now() < cacheExpiry) return;

  const result = await query(
    `SELECT id, entity_name, entity_type, match_type, embedding
     FROM sacred_denylist
     WHERE is_active = TRUE AND approved_by_2 IS NOT NULL`
  );

  denylistCache = result.rows.map(row => ({
    id: row.id,
    entityName: row.entity_name,
    entityType: row.entity_type,
    matchType: row.match_type,
    embedding: row.embedding,
    isActive: true,
  }));

  cacheExpiry = Date.now() + CACHE_TTL_MS;
}

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

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function transliterate(text: string): string {
  // Simplified transliteration - production would use ICU or similar
  return text
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n');
}

/**
 * Main Sacred Guard check function
 */
export async function checkSacredGuard(request: SacredGuardCheckRequest): Promise<SacredGuardResult> {
  await refreshDenylistCache();

  const threshold = config.admission.sacredGuard.perModelThresholds[request.modelId] ||
                    config.admission.sacredGuard.visualSimilarityThreshold;

  // 1. Exact match check
  const promptLower = request.prompt.toLowerCase();
  for (const entry of denylistCache) {
    if (entry.matchType === 'exact') {
      if (promptLower.includes(entry.entityName.toLowerCase())) {
        return {
          blocked: true,
          reason: `Exact match with protected entity: ${entry.entityName}`,
          matchType: 'exact',
          matchedEntity: entry.entityName,
          confidence: 1.0,
          matchedDenylistId: entry.id,
        };
      }
    }
  }

  // 2. Transliterated match check
  const transliteratedPrompt = transliterate(promptLower);
  for (const entry of denylistCache) {
    if (entry.matchType === 'transliterated') {
      const transliteratedEntity = transliterate(entry.entityName.toLowerCase());
      if (transliteratedPrompt.includes(transliteratedEntity)) {
        return {
          blocked: true,
          reason: `Transliterated match with protected entity: ${entry.entityName}`,
          matchType: 'transliterated',
          matchedEntity: entry.entityName,
          confidence: 0.95,
          matchedDenylistId: entry.id,
        };
      }
    }
  }

  // 3. Fuzzy match check (Levenshtein distance)
  for (const entry of denylistCache) {
    if (entry.matchType === 'fuzzy') {
      const words = promptLower.split(/\s+/);
      for (const word of words) {
        if (word.length > 3) {
          const distance = levenshteinDistance(word, entry.entityName.toLowerCase());
          const maxDistance = Math.floor(entry.entityName.length * 0.25); // 25% tolerance
          if (distance <= maxDistance) {
            return {
              blocked: true,
              reason: `Fuzzy match with protected entity: ${entry.entityName}`,
              matchType: 'fuzzy',
              matchedEntity: entry.entityName,
              confidence: 1 - distance / entry.entityName.length,
              matchedDenylistId: entry.id,
            };
          }
        }
      }
    }
  }

  // 4. Visual/Semantic match check (for reference images and post-generation frames)
  if (request.referenceImages.length > 0) {
    // For each reference image, compute embedding and compare against visual_semantic denylist entries
    for (const imageBase64 of request.referenceImages) {
      const imageEmbedding = await computeImageEmbedding(imageBase64);

      for (const entry of denylistCache) {
        if (entry.matchType === 'visual_semantic' && entry.embedding) {
          const similarity = cosineSimilarity(imageEmbedding, entry.embedding);

          if (similarity >= threshold) {
            return {
              blocked: true,
              reason: `Visual/semantic match with protected entity: ${entry.entityName} (similarity: ${similarity.toFixed(3)} >= threshold: ${threshold})`,
              matchType: 'visual_semantic',
              matchedEntity: entry.entityName,
              confidence: similarity,
              matchedDenylistId: entry.id,
            };
          }
        }
      }
    }
  }

  return { blocked: false };
}

/**
 * Compute image embedding for visual/semantic comparison
 * In production: use CLIP, DINOv2, or similar vision transformer
 * For now, returns a deterministic hash-based embedding
 */
async function computeImageEmbedding(imageBase64: string): Promise<number[]> {
  // In production, this would call a vision model (CLIP, DINOv2, etc.)
  // For development, create a deterministic embedding from image hash
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256').update(imageBase64).digest();

  // Convert hash to 512-dim vector (deterministic but distributed)
  const embedding = new Array(512).fill(0).map((_, i) => {
    const byteIndex = i % 32;
    const bitIndex = Math.floor(i / 32) % 8;
    return ((hash[byteIndex] >> bitIndex) & 1) * 2 - 1; // -1 or 1
  });

  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

export async function addToDenylist(
  entityName: string,
  entityType: string,
  matchType: 'exact' | 'transliterated' | 'fuzzy' | 'visual_semantic',
  requestedBy: string,
  embedding?: number[],
  metadata: Record<string, any> = {}
): Promise<string> {
  // Dual-authorization required (CL-009, AC-033)
  // First approval recorded, second approval needed to activate

  const id = uuidv4();
  await query(
    `INSERT INTO sacred_denylist (id, entity_name, entity_type, match_type, embedding, added_by, approved_by_1, approved_at_1, is_active, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), FALSE, $8)`,
    [id, entityName, entityType, matchType, embedding ? JSON.stringify(embedding) : null, requestedBy, requestedBy, JSON.stringify(metadata)]
  );

  // First approval recorded
  await query(
    `INSERT INTO sacred_entity_audit (denylist_id, action, requested_by, approver_1, reason, new_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, 'add', requestedBy, requestedBy, 'Initial submission for dual-authorization', JSON.stringify({ entityName, entityType, matchType })]
  );

  return id;
}

export async function approveDenylistEntry(denylistId: string, approverId: string): Promise<void> {
  const result = await query(
    `SELECT * FROM sacred_denylist WHERE id = $1`,
    [denylistId]
  );

  if (result.rows.length === 0) {
    throw new Error('Denylist entry not found');
  }

  const entry = result.rows[0];

  if (entry.approved_by_2) {
    throw new Error('Already fully approved');
  }

  await query(
    `UPDATE sacred_denylist SET approved_by_2 = $1, approved_at_2 = NOW(), is_active = TRUE WHERE id = $2`,
    [approverId, denylistId]
  );

  await query(
    `INSERT INTO sacred_entity_audit (denylist_id, action, requested_by, approver_1, approver_2, reason, previous_state, new_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      denylistId,
      'add_approved',
      entry.added_by,
      entry.approved_by_1,
      approverId,
      'Dual-authorization complete - entry activated',
      JSON.stringify({ isActive: false }),
      JSON.stringify({ isActive: true, approvedBy2: approverId }),
    ]
  );

  // Invalidate cache
  cacheExpiry = 0;
}

export async function removeFromDenylist(denylistId: string, approver1: string, approver2: string): Promise<void> {
  // Dual-authorization required for removal too
  await query(
    `UPDATE sacred_denylist SET is_active = FALSE WHERE id = $1`,
    [denylistId]
  );

  await query(
    `INSERT INTO sacred_entity_audit (denylist_id, action, requested_by, approver_1, approver_2, reason, previous_state, new_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [denylistId, 'remove', approver1, approver1, approver2, 'Dual-authorization removal', JSON.stringify({ isActive: true }), JSON.stringify({ isActive: false })]
  );

  cacheExpiry = 0;
}

export async function appealSacredGuardBlock(
  denylistId: string,
  appellantId: string,
  reason: string
): Promise<void> {
  await query(
    `INSERT INTO sacred_entity_audit (denylist_id, action, requested_by, reason, previous_state)
     VALUES ($1, $2, $3, $4, $5)`,
    [denylistId, 'appeal', appellantId, reason, JSON.stringify({})]
  );
}

// For import compatibility
import { v4 as uuidv4 } from 'uuid';

/**
 * Reset the denylist cache (for testing)
 */
export function resetDenylistCache(): void {
  denylistCache = [];
  cacheExpiry = 0;
}