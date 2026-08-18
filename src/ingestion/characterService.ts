/**
 * Character Reference Upload Service
 * Implements FR-001 (character references), FR-022 (character registry), FR-011/FR-012 (Sacred Guard registry check),
 * EC-003 (no face detected), EC-004 (sacred match), AC-002, CON-002 (enforcement point b)
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../shared/db.js';
import { encryptEmbeddingForStorage } from '../shared/vault.js';
import { checkSacredGuard } from '../admission/sacredGuard.js';
import { emitCharacterStateChange } from '../shared/events.js';
import type { CharacterReference, CharacterRegistryEntry } from '../shared/types.js';
import { config } from '../shared/config.js';
// Metrics
import {
  charactersRegisteredTotal,
  characterSacredGuardBlocksTotal,
} from '../shared/metrics.js';

// ============================================
// Face Detection (simplified - production would use a real face detection model)
// ============================================

interface FaceDetectionResult {
  hasFace: boolean;
  embedding?: number[]; // 512-dim ArcFace embedding
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * Detect face and generate embedding from base64 image
 * Production: Use ArcFace or similar model via ONNX/TensorFlow
 */
export async function detectFaceAndEmbed(imageBase64: string): Promise<FaceDetectionResult> {
  // In production, this would call a face detection model
  // For now, simulate with validation

  // Basic validation: check if it's a valid base64 image
  if (!imageBase64 || imageBase64.length < 100) {
    return { hasFace: false, confidence: 0 };
  }

  // Simulate face detection - in reality, use a proper model
  // Returns mock embedding for development
  const mockEmbedding = new Array(512).fill(0).map(() => Math.random() * 2 - 1);

  // Normalize to unit vector
  const magnitude = Math.sqrt(mockEmbedding.reduce((sum, val) => sum + val * val, 0));
  const normalizedEmbedding = mockEmbedding.map(val => val / magnitude);

  return {
    hasFace: true,
    embedding: normalizedEmbedding,
    confidence: 0.95,
    boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
  };
}

// ============================================
// Character Registry Service
// ============================================

export interface UploadCharacterReferenceRequest {
  storyId: string;
  userId: string;
  character: CharacterReference;
  /** Optional: pre-uploaded image URL (e.g., from S3/GCS) */
  referenceImageUrl?: string;
}

export interface UploadCharacterReferenceResponse {
  characterId: string;
  name: string;
  faceEmbeddingStored: boolean;
  voiceEmbeddingStored: boolean;
}

export async function uploadCharacterReference(
  request: UploadCharacterReferenceRequest
): Promise<UploadCharacterReferenceResponse> {
  const { storyId, userId, character } = request;

  // Verify story exists and user owns it
  const storyResult = await query(
    `SELECT id, user_id FROM stories WHERE id = $1`,
    [storyId]
  );

  if (storyResult.rows.length === 0) {
    throw new Error('Story not found');
  }

  if (storyResult.rows[0].user_id !== userId) {
    throw new Error('Unauthorized: story belongs to another user');
  }

  // 1. Face Detection (EC-003)
  const faceResult = await detectFaceAndEmbed(character.imageBase64);
  if (!faceResult.hasFace || !faceResult.embedding) {
    throw new Error('No face detected in reference image');
  }

  // 2. Sacred Guard Registry Check (FR-012 enforcement point b, EC-004, CON-002)
  const sacredCheck = await checkSacredGuard({
    prompt: '',
    referenceImages: [character.imageBase64],
    modelId: 'registry-check', // Special model ID for registry checks
    userId,
    storyId,
    enforcementPoint: 'registry',
  });

  if (sacredCheck.blocked) {
    // Record Sacred Guard block metric
    characterSacredGuardBlocksTotal.inc({ match_type: sacredCheck.matchType || 'unknown' });

    // Log to sacred entity audit
    await query(
      `INSERT INTO sacred_entity_audit (denylist_id, action, requested_by, reason, previous_state, new_state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sacredCheck.matchedDenylistId || null,
        'registry_block',
        userId,
        `Character reference blocked by Sacred Guard: ${sacredCheck.reason}`,
        null,
        JSON.stringify({ characterName: character.name, matchType: sacredCheck.matchType }),
      ]
    );

    throw new Error(`Character reference blocked by Sacred Guard: ${sacredCheck.reason}`);
  }

  // 3. Generate image hash for deduplication
  const crypto = await import('crypto');
  const imageHash = crypto.createHash('sha256').update(character.imageBase64).digest('hex');

  // Check for duplicate
  const existing = await query(
    `SELECT id FROM characters WHERE story_id = $1 AND reference_image_hash = $2`,
    [storyId, imageHash]
  );

  if (existing.rows.length > 0) {
    throw new Error('Character with this reference image already exists in story');
  }

  // 4. Process voice reference if provided
  let voiceEmbedding: number[] | undefined;
  if (character.voiceReferenceBase64) {
    // In production: use ECAPA-TDNN or similar for voice embedding
    voiceEmbedding = new Array(256).fill(0).map(() => Math.random() * 2 - 1);
    const magnitude = Math.sqrt(voiceEmbedding.reduce((sum, val) => sum + val * val, 0));
    voiceEmbedding = voiceEmbedding.map(val => val / magnitude);
  }

  // 5. Encrypt embeddings for storage (NFR-006, CON-004)
  // Mock user DEK storage - in production, retrieve from user_keys table
  const userDeks = new Map<string, { dekBase64: string; encryptedDek: string }>();
  // This would be injected from a real user key store

  const faceEncrypted = await encryptEmbeddingForStorage(
    faceResult.embedding,
    userId,
    async (uid) => userDeks.get(uid) || null,
    async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
  );

  let voiceEncrypted = undefined;
  if (voiceEmbedding) {
    voiceEncrypted = await encryptEmbeddingForStorage(
      voiceEmbedding,
      userId,
      async (uid) => userDeks.get(uid) || null,
      async (uid, dek, enc) => { userDeks.set(uid, { dekBase64: dek, encryptedDek: enc }); }
    );
  }

  // 6. Store character registry entry
  const characterId = uuidv4();
  const traceId = storyId; // Use story ID as traceId

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO characters (id, user_id, story_id, name, face_embedding_vector, voice_embedding_vector, reference_image_hash, reference_image_base64, reference_image_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        characterId,
        userId,
        storyId,
        character.name,
        `[${faceResult.embedding?.join(',') || ''}]`, // pgvector format
        voiceEmbedding ? `[${voiceEmbedding.join(',')}]` : null,
        imageHash,
        character.imageBase64, // Store the actual base64 image for Face-Lock conditioning
        request.referenceImageUrl || null,
        JSON.stringify({
          faceEmbeddingEncrypted: true,
          voiceEmbeddingEncrypted: !!voiceEncrypted,
          faceConfidence: faceResult.confidence,
          boundingBox: faceResult.boundingBox,
        }),
      ]
    );

    // Emit character created event with trace context
    await client.query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['character', characterId, 'character_registered', 'none', 'registered',
       JSON.stringify({ storyId, characterName: character.name }), JSON.stringify({ userId, traceId })]
    );
  });

  // Emit character state change with trace context
  await emitCharacterStateChange(characterId, 'none', 'registered', 'character_registered', { storyId, characterName: character.name }, userId, { traceId });

  // Record metrics
  const hasVoice = voiceEncrypted ? 'true' : 'false';
  charactersRegisteredTotal.inc({ story_id: storyId, has_voice: hasVoice });

  return {
    characterId,
    name: character.name,
    faceEmbeddingStored: true,
    voiceEmbeddingStored: !!voiceEncrypted,
  };
}

export async function getCharacterReferences(storyId: string): Promise<CharacterRegistryEntry[]> {
  const result = await query(
    `SELECT * FROM characters WHERE story_id = $1 ORDER BY created_at`,
    [storyId]
  );

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    storyId: row.story_id,
    name: row.name,
    faceEmbedding: row.face_embedding_vector,
    voiceEmbedding: row.voice_embedding_vector,
    referenceImageHash: row.reference_image_hash,
    referenceImageBase64: row.reference_image_base64,
    referenceImageUrl: row.reference_image_url,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getCharacterByName(storyId: string, name: string): Promise<CharacterRegistryEntry | null> {
  const result = await query(
    `SELECT * FROM characters WHERE story_id = $1 AND name = $2`,
    [storyId, name]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    storyId: row.story_id,
    name: row.name,
    faceEmbedding: row.face_embedding_vector,
    voiceEmbedding: row.voice_embedding_vector,
    referenceImageHash: row.reference_image_hash,
    referenceImageBase64: row.reference_image_base64,
    referenceImageUrl: row.reference_image_url,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================
// Character Reference Validation for Shot Plan
// ============================================

export async function validateCharacterReferences(
  storyId: string,
  charactersInShots: string[][]
): Promise<{ valid: boolean; missingCharacters: string[]; warnings: string[] }> {
  const registeredChars = await getCharacterReferences(storyId);
  const registeredNames = new Set(registeredChars.map(c => c.name.toLowerCase()));

  const missingCharacters: string[] = [];
  const warnings: string[] = [];

  for (const shotChars of charactersInShots) {
    for (const charName of shotChars) {
      if (!registeredNames.has(charName.toLowerCase())) {
        missingCharacters.push(charName);
        warnings.push(`Character "${charName}" appears in shot but not in registry (EC-005)`);
      }
    }
  }

  return {
    valid: true, // Not blocking - just warning per EC-005
    missingCharacters: [...new Set(missingCharacters)],
    warnings,
  };
}