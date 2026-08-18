/**
 * Preference Extraction Service
 * After story delivery, analyzes user feedback + settings to extract learned preferences
 */

import { query } from '../shared/db.js';
import type { UserPreferenceData } from '../shared/types.js';

/**
 * Extract and store learned preferences for a user based on their feedback and settings
 * Called after a story is delivered
 */
export async function extractPreferences(userId: string): Promise<UserPreferenceData> {
  // Get recent feedback for this user (last 20 stories)
  const feedbackResult = await query<{
    story_id: string;
    rating: number | null;
    flag_reason: string | null;
    model_id: string | null;
    quality: string | null;
    total_cost: number | null;
  }>(
    `SELECT f.story_id, f.rating, f.flag_reason,
            s.selected_model_id as model_id,
            s.quality_preset as quality,
            st.total_actual_cost as total_cost
     FROM user_feedback f
     JOIN stories st ON f.story_id = st.id
     LEFT JOIN shots s ON f.shot_id = s.id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC
     LIMIT 100`,
    [userId]
  );

  // Get user settings
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId]
  );

  const preferences: UserPreferenceData = {};

  if (feedbackResult.rows.length === 0) {
    // No feedback yet, return empty preferences
    return preferences;
  }

  // Extract preferred model from highest-rated stories
  const ratedStories = feedbackResult.rows.filter(r => r.rating !== null && r.model_id);
  if (ratedStories.length > 0) {
    // Weight by rating: find model with highest average rating
    const modelRatings = new Map<string, number[]>();
    for (const row of ratedStories) {
      if (!modelRatings.has(row.model_id!)) {
        modelRatings.set(row.model_id!, []);
      }
      modelRatings.get(row.model_id!)!.push(row.rating!);
    }

    let bestModel = '';
    let bestAvg = 0;
    for (const [model, ratings] of modelRatings) {
      const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestModel = model;
      }
    }
    if (bestModel) {
      preferences.preferredModel = bestModel;
    }
  }

  // Extract preferred quality from feedback patterns
  const qualityFeedback = feedbackResult.rows.filter(r => r.quality && r.rating !== null);
  if (qualityFeedback.length > 0) {
    const qualityRatings = new Map<string, number[]>();
    for (const row of qualityFeedback) {
      if (!qualityRatings.has(row.quality!)) {
        qualityRatings.set(row.quality!, []);
      }
      qualityRatings.get(row.quality!)!.push(row.rating!);
    }

    let bestQuality = '';
    let bestQualityAvg = 0;
    for (const [quality, ratings] of qualityRatings) {
      const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      if (avg > bestQualityAvg) {
        bestQualityAvg = avg;
        bestQuality = quality;
      }
    }
    if (bestQuality) {
      preferences.preferredQuality = bestQuality as UserPreferenceData['preferredQuality'];
    }
  }

  // Extract cost sensitivity from flag patterns
  const costFlags = feedbackResult.rows.filter(r => r.flag_reason === 'cost_too_high');
  if (costFlags.length > 3) {
    preferences.costBudgetUsd = 50; // Conservative budget preference
  }

  // Extract face-lock threshold preference
  const highRatings = feedbackResult.rows.filter(r => r.rating && r.rating >= 4);
  if (highRatings.length > 5) {
    // User values consistency — suggest slightly higher threshold
    preferences.faceLockThreshold = 0.80;
  }

  // Mark as learned from feedback
  preferences.learnedFromFeedback = true;
  preferences.lastExtractedAt = new Date();

  // Store extracted preferences
  await query(
    `INSERT INTO user_preferences (user_id, preferences, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET preferences = user_preferences.preferences || $2,
         updated_at = NOW()`,
    [userId, JSON.stringify(preferences)]
  );

  return preferences;
}

/**
 * Get stored preferences for a user
 */
export async function getPreferences(userId: string): Promise<UserPreferenceData> {
  const result = await query<{ preferences: UserPreferenceData }>(
    'SELECT preferences FROM user_preferences WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return {};
  }

  return result.rows[0].preferences;
}
