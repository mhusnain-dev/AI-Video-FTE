/**
 * Story Ingestion Service
 * Implements FR-001, FR-002, FR-003, FR-004, AC-001, AC-002, AC-003, AC-004
 */

import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../shared/db.js';
import { storyStateMachine, emitStoryStateChange } from '../shared/events.js';
import { publishStoryCommand } from '../shared/redis.js';
import type { Story, StoryBrief, ShotPlan, StoryStatus, AspectRatio, Resolution, CharacterReference, ShotPlanRevision } from '../shared/types.js';
import { config } from '../shared/config.js';
// Metrics
import {
  storiesCreatedTotal,
  storyDecompositionDurationSeconds,
  shotPlanRevisedTotal,
  activeStoriesGauge,
} from '../shared/metrics.js';

// ============================================
// Shot Decomposition Engine (FR-002)
// ============================================

interface DecomposedShot {
  order: number;
  visualDescription: string;
  durationSeconds: number;
  cameraMotion: string;
  characters: string[];
  keyObjects: string[];
  keyActions: string[];
  audioCues?: string[];
}

/**
 * Decompose narrative into structured shots
 * This is a simplified implementation - production would use LLM
 */
export async function decomposeStoryToShots(brief: StoryBrief): Promise<DecomposedShot[]> {
  const startTime = Date.now();
  const sentences = brief.narrative.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const targetDuration = brief.targetDurationSeconds;
  const shots: DecomposedShot[] = [];

  // Simple heuristic: 1 shot per 5-10 seconds, max based on model capability
  const estimatedShots = Math.max(1, Math.min(20, Math.ceil(targetDuration / 8)));

  for (let i = 0; i < estimatedShots; i++) {
    const sentenceIndex = Math.min(i, sentences.length - 1);
    const sentence = sentences[sentenceIndex]?.trim() || `Continuation of scene ${i + 1}`;

    // Extract characters mentioned in this segment
    const charactersInShot = brief.characterReferences
      ?.filter(cr => sentence.toLowerCase().includes(cr.name.toLowerCase()))
      .map(cr => cr.name) || [];

    shots.push({
      order: i,
      visualDescription: sentence,
      durationSeconds: Math.round(targetDuration / estimatedShots),
      cameraMotion: i === 0 ? 'establishing wide shot' : 'medium shot with subtle pan',
      characters: charactersInShot,
      keyObjects: extractObjects(sentence),
      keyActions: extractActions(sentence),
      audioCues: i === 0 ? ['ambient intro'] : [],
    });
  }

  // Record metrics
  storyDecompositionDurationSeconds.observe({ shot_count: shots.length.toString() }, (Date.now() - startTime) / 1000);

  return shots;
}

function extractObjects(text: string): string[] {
  const objects: string[] = [];
  const objectKeywords = ['car', 'building', 'tree', 'phone', 'computer', 'book', 'door', 'window', 'table', 'chair'];
  for (const keyword of objectKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      objects.push(keyword);
    }
  }
  return objects;
}

function extractActions(text: string): string[] {
  const actions: string[] = [];
  const actionKeywords = ['walking', 'running', 'talking', 'sitting', 'standing', 'looking', 'opening', 'closing'];
  for (const keyword of actionKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      actions.push(keyword);
    }
  }
  return actions;
}

// ============================================
// Story Service
// ============================================

export interface CreateStoryRequest {
  brief: StoryBrief;
  userId: string;
}

export interface CreateStoryResponse {
  storyId: string;
  shotPlan: ShotPlan[];
  status: StoryStatus;
}

export async function createStory(request: CreateStoryRequest): Promise<CreateStoryResponse> {
  const { brief, userId } = request;

  // Validate: empty narrative check (EC-001, AC-004)
  if (!brief.narrative || brief.narrative.trim().length === 0) {
    throw new Error('Story narrative required');
  }

  // Validate aspect ratio (CL-018)
  const validAspectRatios: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];
  const aspectRatio = brief.aspectRatio || '16:9';
  if (!validAspectRatios.includes(aspectRatio)) {
    throw new Error(`Invalid aspect ratio. Supported: ${validAspectRatios.join(', ')}`);
  }

  // Validate resolution
  const validResolutions: Resolution[] = ['720p', '1080p', '4K'];
  const resolution = brief.resolution || '1080p';
  if (!validResolutions.includes(resolution)) {
    throw new Error(`Invalid resolution. Supported: ${validResolutions.join(', ')}`);
  }

  // Decompose into shots (FR-002)
  const decomposedShots = await decomposeStoryToShots(brief);

  // Validate: zero shots check (EC-002)
  if (decomposedShots.length === 0) {
    throw new Error('Unable to derive shots from narrative');
  }

  // Validate max shot limit (EC-011) - will be checked per model during routing
  // For now, just warn if excessive
  if (decomposedShots.length > 50) {
    console.warn(`Story has ${decomposedShots.length} shots, may exceed model limits`);
  }

  // Create story and shots in transaction
  const storyId = uuidv4();
  const traceId = uuidv4(); // Generate traceId at story creation
  const story: Story = {
    id: storyId,
    userId,
    brief,
    shots: [],
    status: 'planning',
    aspectRatio,
    targetDurationSeconds: brief.targetDurationSeconds,
    resolution,
    globalTransition: brief.transition || { type: 'crossfade', durationSeconds: 0.5 }, // CL-014
    audioConfig: brief.audioConfig,
    totalEstimatedCost: 0,
    totalActualCost: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await transaction(async (client) => {
    // Insert story
    await client.query(
      `INSERT INTO stories (id, user_id, brief, status, aspect_ratio, target_duration_seconds, resolution, global_transition, audio_config, total_estimated_cost, total_actual_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        story.id,
        story.userId,
        JSON.stringify(story.brief),
        story.status,
        story.aspectRatio,
        story.targetDurationSeconds,
        story.resolution,
        JSON.stringify(story.globalTransition),
        story.audioConfig ? JSON.stringify(story.audioConfig) : null,
        story.totalEstimatedCost,
        story.totalActualCost,
      ]
    );

    // Insert shots
    for (const shot of decomposedShots) {
      const shotId = uuidv4();
      const shotPlan: ShotPlan = {
        id: shotId,
        storyId,
        order: shot.order,
        visualDescription: shot.visualDescription,
        durationSeconds: shot.durationSeconds,
        cameraMotion: shot.cameraMotion,
        characters: shot.characters,
        keyObjects: shot.keyObjects,
        keyActions: shot.keyActions,
        audioCues: shot.audioCues,
        styleReferences: brief.styleReferences,
        negativePrompts: brief.negativePrompts,
        transition: shot.order > 0 ? { type: 'crossfade', durationSeconds: 0.5 } : undefined,
        status: 'planned',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      story.shots.push(shotPlan);

      await client.query(
        `INSERT INTO shots (id, story_id, order_index, visual_description, duration_seconds, camera_motion, characters, key_objects, key_actions, audio_cues, style_references, negative_prompts, transition, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          shotPlan.id,
          storyId,
          shotPlan.order,
          shotPlan.visualDescription,
          shotPlan.durationSeconds,
          shotPlan.cameraMotion,
          shotPlan.characters,
          shotPlan.keyObjects,
          shotPlan.keyActions,
          shotPlan.audioCues || null,
          shotPlan.styleReferences || null,
          shotPlan.negativePrompts || null,
          shotPlan.transition ? JSON.stringify(shotPlan.transition) : null,
          shotPlan.status,
        ]
      );
    }

    // Emit state change event with trace context
    await client.query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['story', storyId, 'decompose_shots', 'draft', 'planning', JSON.stringify({ shotCount: decomposedShots.length }), JSON.stringify({ userId, traceId })]
    );
  });

  // Update state machine with trace context
  storyStateMachine.setCurrentState(storyId, 'planning');

  // Fire-and-forget: emit state change to Redis (don't block the response)
  emitStoryStateChange(storyId, 'draft', 'planning', 'decompose_shots', { shotCount: decomposedShots.length }, userId, { traceId }).catch(err => {
    console.error('[StoryService] Failed to emit state change (non-blocking):', err.message);
  });

  // Record metrics
  storiesCreatedTotal.inc({ user_id: userId, status: 'planning' });
  activeStoriesGauge.inc();

  return {
    storyId,
    shotPlan: story.shots,
    status: 'planning',
  };
}

export async function getStory(storyId: string): Promise<Story | null> {
  const storyResult = await query(
    `SELECT * FROM stories WHERE id = $1`,
    [storyId]
  );

  if (storyResult.rows.length === 0) {
    return null;
  }

  const storyRow = storyResult.rows[0];

  const shotsResult = await query(
    `SELECT * FROM shots WHERE story_id = $1 ORDER BY order_index`,
    [storyId]
  );

  const shots: ShotPlan[] = shotsResult.rows.map(row => ({
    id: row.id,
    storyId: row.story_id,
    order: row.order_index,
    visualDescription: row.visual_description,
    durationSeconds: row.duration_seconds,
    cameraMotion: row.camera_motion,
    characters: row.characters,
    keyObjects: row.key_objects,
    keyActions: row.key_actions,
    audioCues: row.audio_cues,
    styleReferences: row.style_references,
    negativePrompts: row.negative_prompts,
    modelOverride: row.model_override,
    transition: row.transition ? (typeof row.transition === 'string' ? JSON.parse(row.transition) : row.transition) : undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    id: storyRow.id,
    userId: storyRow.user_id,
    brief: storyRow.brief,
    shots,
    status: storyRow.status,
    aspectRatio: storyRow.aspect_ratio,
    targetDurationSeconds: storyRow.target_duration_seconds,
    resolution: storyRow.resolution,
    globalTransition: storyRow.global_transition ? (typeof storyRow.global_transition === 'string' ? JSON.parse(storyRow.global_transition) : storyRow.global_transition) : undefined,
    audioConfig: storyRow.audio_config ? (typeof storyRow.audio_config === 'string' ? JSON.parse(storyRow.audio_config) : storyRow.audio_config) : undefined,
    totalEstimatedCost: parseFloat(storyRow.total_estimated_cost),
    totalActualCost: parseFloat(storyRow.total_actual_cost),
    createdAt: storyRow.created_at,
    updatedAt: storyRow.updated_at,
    completedAt: storyRow.completed_at,
  };
}

export async function updateStoryStatus(storyId: string, status: StoryStatus): Promise<void> {
  await query(
    `UPDATE stories SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, storyId]
  );
  storyStateMachine.setCurrentState(storyId, status);
}

// ============================================
// Plan Revision (FR-003, FR-004, AC-003)
// ============================================

export async function reviseShotPlan(storyId: string, revisions: ShotPlanRevision[]): Promise<ShotPlan[]> {
  const story = await getStory(storyId);
  if (!story) {
    throw new Error('Story not found');
  }

  if (story.status !== 'planning' && story.status !== 'awaiting_approval') {
    throw new Error(`Cannot revise plan in status: ${story.status}`);
  }

  await transaction(async (client) => {
    for (const revision of revisions) {
      switch (revision.action) {
        case 'add':
          if (revision.shotData) {
            const newShotId = uuidv4();
            const newOrder = revision.shotData.order ?? story.shots.length;

            // Shift existing shots
            await client.query(
              `UPDATE shots SET order_index = order_index + 1 WHERE story_id = $1 AND order_index >= $2`,
              [storyId, newOrder]
            );

            const newShot: ShotPlan = {
              id: newShotId,
              storyId,
              order: newOrder,
              visualDescription: revision.shotData.visualDescription || '',
              durationSeconds: revision.shotData.durationSeconds || 5,
              cameraMotion: revision.shotData.cameraMotion || 'static',
              characters: revision.shotData.characters || [],
              keyObjects: revision.shotData.keyObjects || [],
              keyActions: revision.shotData.keyActions || [],
              audioCues: revision.shotData.audioCues,
              styleReferences: revision.shotData.styleReferences,
              negativePrompts: revision.shotData.negativePrompts,
              transition: { type: 'crossfade', durationSeconds: 0.5 },
              status: 'planned',
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await client.query(
              `INSERT INTO shots (id, story_id, order_index, visual_description, duration_seconds, camera_motion, characters, key_objects, key_actions, audio_cues, style_references, negative_prompts, transition, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                newShot.id,
                storyId,
                newShot.order,
                newShot.visualDescription,
                newShot.durationSeconds,
                newShot.cameraMotion,
                newShot.characters,
                newShot.keyObjects,
                newShot.keyActions,
                newShot.audioCues || null,
                newShot.styleReferences || null,
                newShot.negativePrompts || null,
                JSON.stringify(newShot.transition),
                newShot.status,
              ]
            );

            story.shots.push(newShot);
          }
          break;

        case 'remove':
          if (revision.shotId) {
            const shotToRemove = story.shots.find(s => s.id === revision.shotId);
            if (shotToRemove) {
              await client.query(
                `DELETE FROM shots WHERE id = $1`,
                [revision.shotId]
              );

              // Reorder remaining shots
              await client.query(
                `UPDATE shots SET order_index = order_index - 1 WHERE story_id = $1 AND order_index > $2`,
                [storyId, shotToRemove.order]
              );

              story.shots = story.shots.filter(s => s.id !== revision.shotId);
              story.shots.forEach((s, idx) => { s.order = idx; });
            }
          }
          break;

        case 'reorder':
          if (revision.shotId && revision.newOrder !== undefined) {
            const shotToMove = story.shots.find(s => s.id === revision.shotId);
            if (shotToMove) {
              const oldOrder = shotToMove.order;
              const newOrder = Math.max(0, Math.min(revision.newOrder, story.shots.length - 1));

              if (oldOrder !== newOrder) {
                if (oldOrder < newOrder) {
                  // Move down: shift others up
                  await client.query(
                    `UPDATE shots SET order_index = order_index - 1 WHERE story_id = $1 AND order_index > $2 AND order_index <= $3`,
                    [storyId, oldOrder, newOrder]
                  );
                } else {
                  // Move up: shift others down
                  await client.query(
                    `UPDATE shots SET order_index = order_index + 1 WHERE story_id = $1 AND order_index >= $2 AND order_index < $3`,
                    [storyId, newOrder, oldOrder]
                  );
                }

                await client.query(
                  `UPDATE shots SET order_index = $1 WHERE id = $2`,
                  [newOrder, revision.shotId]
                );

                // Rebuild array
                story.shots = story.shots.filter(s => s.id !== revision.shotId);
                story.shots.splice(newOrder, 0, shotToMove);
                story.shots.forEach((s, idx) => { s.order = idx; });
              }
            }
          }
          break;

        case 'edit':
          if (revision.shotId && revision.shotData) {
            const updates: string[] = [];
            const params: any[] = [revision.shotId];

            if (revision.shotData.visualDescription !== undefined) {
              updates.push(`visual_description = $${params.length + 1}`);
              params.push(revision.shotData.visualDescription);
            }
            if (revision.shotData.durationSeconds !== undefined) {
              updates.push(`duration_seconds = $${params.length + 1}`);
              params.push(revision.shotData.durationSeconds);
            }
            if (revision.shotData.cameraMotion !== undefined) {
              updates.push(`camera_motion = $${params.length + 1}`);
              params.push(revision.shotData.cameraMotion);
            }
            if (revision.shotData.characters !== undefined) {
              updates.push(`characters = $${params.length + 1}`);
              params.push(revision.shotData.characters);
            }
            if (revision.shotData.keyObjects !== undefined) {
              updates.push(`key_objects = $${params.length + 1}`);
              params.push(revision.shotData.keyObjects);
            }
            if (revision.shotData.keyActions !== undefined) {
              updates.push(`key_actions = $${params.length + 1}`);
              params.push(revision.shotData.keyActions);
            }
            if (revision.shotData.audioCues !== undefined) {
              updates.push(`audio_cues = $${params.length + 1}`);
              params.push(revision.shotData.audioCues);
            }
            if (revision.shotData.styleReferences !== undefined) {
              updates.push(`style_references = $${params.length + 1}`);
              params.push(revision.shotData.styleReferences);
            }
            if (revision.shotData.negativePrompts !== undefined) {
              updates.push(`negative_prompts = $${params.length + 1}`);
              params.push(revision.shotData.negativePrompts);
            }
            if (revision.shotData.transition !== undefined) {
              updates.push(`transition = $${params.length + 1}`);
              params.push(JSON.stringify(revision.shotData.transition));
            }
            if (revision.shotData.modelOverride !== undefined) {
              updates.push(`model_override = $${params.length + 1}`);
              params.push(revision.shotData.modelOverride);
            }

            if (updates.length > 0) {
              updates.push(`updated_at = NOW()`);
              await client.query(
                `UPDATE shots SET ${updates.join(', ')} WHERE id = $1`,
                params
              );
            }
          }
          break;
      }
    }

    // Emit revision event
    await client.query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['story', storyId, 'plan_revised', story.status, story.status, JSON.stringify({ revisions }), JSON.stringify({})]
    );
  });

  // Record metrics
  for (const revision of revisions) {
    shotPlanRevisedTotal.inc({ action: revision.action });
  }

  // Return updated shots
  const updatedStory = await getStory(storyId);
  return updatedStory!.shots;
}

// ============================================
// Plan Presentation (FR-003, AC-001)
// ============================================

export async function presentShotPlan(storyId: string): Promise<{ storyId: string; shotPlan: ShotPlan[]; status: StoryStatus }> {
  const story = await getStory(storyId);
  if (!story) {
    throw new Error('Story not found');
  }

  if (story.status !== 'planning') {
    throw new Error(`Cannot present plan in status: ${story.status}`);
  }

  // Transition to awaiting_approval
  await query(
    `UPDATE stories SET status = 'awaiting_approval', updated_at = NOW() WHERE id = $1`,
    [storyId]
  );
  storyStateMachine.setCurrentState(storyId, 'awaiting_approval');

  // Emit event with trace context
  await emitStoryStateChange(storyId, 'planning', 'awaiting_approval', 'present_plan', { shotCount: story.shots.length }, 'system', { traceId: story.id }); // Use story ID as traceId for now

  return {
    storyId,
    shotPlan: story.shots,
    status: 'awaiting_approval',
  };
}

// ============================================
// User Approval (FR-003)
// ============================================

export async function approveShotPlan(storyId: string, userId: string): Promise<void> {
  const story = await getStory(storyId);
  if (!story) {
    throw new Error('Story not found');
  }

  if (story.status !== 'awaiting_approval') {
    throw new Error(`Cannot approve plan in status: ${story.status}`);
  }

  await query(
    `UPDATE stories SET status = 'approved', updated_at = NOW() WHERE id = $1`,
    [storyId]
  );
  storyStateMachine.setCurrentState(storyId, 'approved');

  // Emit event with trace context
  await emitStoryStateChange(storyId, 'awaiting_approval', 'approved', 'user_approve', {}, userId, { traceId: story.id });

  // Record metrics
  storiesCreatedTotal.inc({ user_id: userId, status: 'approved' });

  // Queue the dispatch command so the CommandHandlerConsumer generates the shots.
  // Approval must be durable even if the stream publish fails (operator can retry).
  try {
    await publishStoryCommand('approve', { storyId, userId });
    console.log(`Published 'approve' command for story ${storyId}`);
  } catch (error) {
    console.error(`Failed to publish 'approve' command for story ${storyId}:`, error);
  }
}

/**
 * Approve merge from pending_merge state (human approval gate)
 */
export async function approveMerge(storyId: string): Promise<void> {
  const story = await getStory(storyId);
  if (!story) {
    throw new Error('Story not found');
  }

  if (story.status !== 'pending_merge') {
    throw new Error(`Cannot approve merge in status: ${story.status}`);
  }

  await storyStateMachine.transition(storyId, 'user_approve_merge', {}, 'system');

  await query(
    `UPDATE stories SET status = 'merging', updated_at = NOW() WHERE id = $1`,
    [storyId]
  );

  console.log(`Story ${storyId} merge approved — transitioning to merging`);
}