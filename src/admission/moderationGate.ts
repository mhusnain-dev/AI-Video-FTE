/**
 * Moderation Gate Service
 * Gate 1 of Admission Pipeline (FR-010, CON-001)
 * Screens for: violence, sexual content, hate, PII, CSAM
 * Blocks with categorized rejection reason
 */

import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import type { AdmissionContext, ModerationConfig } from '../shared/types.js';

export interface ModerationResult {
  blocked: boolean;
  category?: 'violence' | 'sexual_content' | 'hate' | 'pii' | 'csam' | 'other';
  reason?: string;
  confidence?: number;
  flaggedContent?: string[];
}

/**
 * Main moderation check function
 * In production, this would integrate with a moderation API (Google, AWS, Azure, or custom)
 */
export async function checkModeration(context: AdmissionContext): Promise<ModerationResult> {
  const moderationConfig = config.admission.moderation;

  // Check prompt text
  const promptResult = await moderateText(context.prompt, moderationConfig);
  if (promptResult.blocked) {
    return promptResult;
  }

  // Check reference images (if any)
  if (context.referenceImages.length > 0) {
    for (const imageBase64 of context.referenceImages) {
      const imageResult = await moderateImage(imageBase64, moderationConfig);
      if (imageResult.blocked) {
        return {
          ...imageResult,
          reason: `Reference image: ${imageResult.reason}`,
        };
      }
    }
  }

  return { blocked: false };
}

/**
 * Moderate text content for policy violations
 */
async function moderateText(text: string, moderationConfig: ModerationConfig): Promise<ModerationResult> {
  const categories = moderationConfig.categories;
  const threshold = moderationConfig.threshold;

  // In production: call moderation API (e.g., Google Cloud Natural Language, AWS Comprehend, Perspective API)
  // For now, implement keyword-based detection with categories

  const detections: Array<{ category: string; matched: string; confidence: number }> = [];

  // Violence detection
  if (categories.includes('violence')) {
    const violenceKeywords = [
      'kill', 'murder', 'assault', 'bomb', 'weapon', 'gun', 'knife', 'blood',
      'violence', 'violent', 'attack', 'harm', 'injury', 'death', 'dead',
      'shoot', 'stab', 'beat', 'torture', 'abuse',
    ];
    for (const keyword of violenceKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) {
        detections.push({ category: 'violence', matched: keyword, confidence: 0.8 });
      }
    }
  }

  // CSAM detection (Child Sexual Abuse Material)
  // Check FIRST before sexual_content since it's more specific
  if (categories.includes('csam')) {
    const csamKeywords = [
      'child porn', 'child pornography', 'child sexual', 'minor sexual', 'underage', 'teen porn',
      'child abuse', 'pedo', 'lolita', 'preteen',
    ];
    for (const keyword of csamKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) {
        detections.push({ category: 'csam', matched: keyword, confidence: 0.99 });
      }
    }
  }

  // Sexual content detection
  if (categories.includes('sexual_content')) {
    const sexualKeywords = [
      'porn', 'pornography', 'sex', 'sexual', 'nude', 'naked', 'explicit',
      'erotic', 'xxx', 'adult content', 'genital', 'breast', 'penis', 'vagina',
      'masturbation', 'orgasm', 'intercourse',
    ];
    for (const keyword of sexualKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) {
        detections.push({ category: 'sexual_content', matched: keyword, confidence: 0.85 });
      }
    }
  }

  // Hate speech detection
  if (categories.includes('hate')) {
    const hatePatterns = [
      // Slurs and hate terms (simplified - production uses comprehensive lists)
      { pattern: /\b(nazi|fascist|supremacist|klan)\b/i, category: 'hate' },
      { pattern: /\b(hate|discriminat|prejudice|bigot)\b/i, category: 'hate' },
    ];
    for (const { pattern, category } of hatePatterns) {
      if (pattern.test(text)) {
        detections.push({ category, matched: text.match(pattern)?.[0] || '', confidence: 0.9 });
      }
    }
  }

  // PII detection
  if (categories.includes('pii')) {
    const piiPatterns = [
      // Email
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, category: 'pii', type: 'email' },
      // Phone (US)
      { pattern: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/, category: 'pii', type: 'phone' },
      // SSN
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/, category: 'pii', type: 'ssn' },
      // Credit card
      { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, category: 'pii', type: 'credit_card' },
      // Address (simplified)
      { pattern: /\b\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)\b/i, category: 'pii', type: 'address' },
    ];
    for (const { pattern, category, type } of piiPatterns) {
      if (pattern.test(text)) {
        detections.push({ category, matched: `[${type} detected]`, confidence: 0.95 });
      }
    }
  }

  // CSAM detection (Child Sexual Abuse Material)
  if (categories.includes('csam')) {
    const csamKeywords = [
      'child porn', 'child sexual', 'minor sexual', 'underage', 'teen porn',
      'child abuse', 'pedo', 'lolita', 'preteen',
    ];
    for (const keyword of csamKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) {
        detections.push({ category: 'csam', matched: keyword, confidence: 0.99 });
      }
    }
  }

  // Find highest confidence detection above threshold
  const blockedDetections = detections.filter(d => d.confidence >= threshold);

  if (blockedDetections.length > 0) {
    // Sort by confidence descending
    blockedDetections.sort((a, b) => b.confidence - a.confidence);
    const top = blockedDetections[0];

    return {
      blocked: true,
      category: top.category as ModerationResult['category'],
      reason: `Content flagged for ${top.category}: "${top.matched}"`,
      confidence: top.confidence,
      flaggedContent: blockedDetections.map(d => d.matched),
    };
  }

  return { blocked: false };
}

/**
 * Moderate image content
 * In production: use Vision API (Google Cloud Vision, AWS Rekognition, Azure Computer Vision)
 * or specialized NSFW/CSAM detection models
 */
async function moderateImage(imageBase64: string, _moderationConfig: ModerationConfig): Promise<ModerationResult> {
  // Validate base64
  if (!imageBase64 || imageBase64.length < 100) {
    return { blocked: false };
  }

  // In production: decode base64 and send to vision moderation API
  // For now, return not blocked (would integrate with actual image moderation)
  // Example integration:
  /*
  const visionClient = new VisionClient();
  const [result] = await visionClient.safeSearchDetection(imageBase64);
  const safeSearch = result.safeSearchAnnotation;

  if (safeSearch.adult === 'LIKELY' || safeSearch.adult === 'VERY_LIKELY') {
    return { blocked: true, category: 'sexual_content', reason: 'Image contains adult content', confidence: 0.9 };
  }
  if (safeSearch.violence === 'LIKELY' || safeSearch.violence === 'VERY_LIKELY') {
    return { blocked: true, category: 'violence', reason: 'Image contains violence', confidence: 0.9 };
  }
  if (safeSearch.medical === 'LIKELY') {
    return { blocked: true, category: 'other', reason: 'Image may contain medical content', confidence: 0.7 };
  }
  */

  return { blocked: false };
}

/**
 * Record moderation decision to audit log
 */
export async function recordModerationAudit(
  context: AdmissionContext,
  result: ModerationResult
): Promise<void> {
  await query(
    `INSERT INTO admission_audit (story_id, shot_id, gate, decision, reason, category, rule_triggered, full_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.storyId,
      context.shotId,
      'moderation',
      result.blocked ? 'fail' : 'pass',
      result.reason,
      result.category,
      result.category ? `moderation_${result.category}` : null,
      JSON.stringify({
        prompt: context.prompt,
        referenceImageCount: context.referenceImages.length,
        modelId: context.modelId,
        userId: context.userId,
        flaggedContent: result.flaggedContent,
      }),
    ]
  );
}