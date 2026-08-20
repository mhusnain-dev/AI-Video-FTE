/**
 * Command Handler Consumer
 * Consumes story_commands stream and dispatches shots via shotDispatcher
 * Implements FR-017, FR-018, FR-019
 */

import { BaseConsumer, ConsumerOptions } from './baseConsumer.js';
import { STREAMS, CONSUMER_GROUPS } from '../shared/redis.js';
import { query } from '../shared/db.js';
import { dispatchShot, dispatchWithFallback, isShotDispatched } from '../dispatch/shotDispatcher.js';
import { compilePrompt } from '../generation/promptCompiler.js';
import { selectModelForShot } from '../router/autoRouter.js';
import { getCharacterReferences } from '../ingestion/characterService.js';
import type { ShotPlan } from '../shared/types.js';
import type { StreamMessage } from '../shared/redis.js';

export interface CommandHandlerOptions extends Omit<ConsumerOptions, 'groupName' | 'stream'> {
  /** Maximum concurrent dispatches */
  maxConcurrentDispatches?: number;
  /** Default timeout for shot dispatch (seconds) */
  defaultTimeoutSeconds?: number;
}

interface StoryCommandPayload {
  storyId: string;
  userId: string;
  shotIds?: string[];
  force?: boolean;
}

export class CommandHandlerConsumer extends BaseConsumer {
  private readonly handlerOptions: Required<{
    maxConcurrentDispatches: number;
    defaultTimeoutSeconds: number;
  }>;

  constructor(options: CommandHandlerOptions) {
    super({
      ...options,
      groupName: CONSUMER_GROUPS.COMMAND_HANDLER,
      stream: STREAMS.STORY_COMMANDS,
    });

    this.handlerOptions = {
      maxConcurrentDispatches: options.maxConcurrentDispatches ?? 3,
      defaultTimeoutSeconds: options.defaultTimeoutSeconds ?? 600,
    };
  }

  protected async processMessage(message: StreamMessage): Promise<void> {
    const command = message.data.command;
    const payloadStr = message.data.payload;

    if (!command || !payloadStr) {
      console.warn(`Message ${message.id} missing command or payload`);
      return;
    }

    const payload: StoryCommandPayload = JSON.parse(payloadStr);

    console.log(`Processing command: ${command} for story ${payload.storyId}`);

    switch (command) {
      case 'approve':
        await this.handleApprove(payload);
        break;
      case 'regenerate_shots':
        await this.handleRegenerateShots(payload);
        break;
      case 'create':
      case 'revise':
      case 'cancel':
        // These commands are handled elsewhere (ingestion/plan)
        console.log(`Command ${command} not handled by CommandHandlerConsumer`);
        break;
      default:
        console.warn(`Unknown command: ${command}`);
    }
  }

  /**
   * Handle 'approve' command - dispatch all shots in the shot plan
   */
  private async handleApprove(payload: StoryCommandPayload): Promise<void> {
    const { storyId, userId, shotIds, force = false } = payload;

    // Fetch the story with its shot plan - retry for transaction visibility
    console.log(`[CMD DEBUG] handleApprove: fetching story ${storyId}`);
    let storyResult = await query(
      `SELECT * FROM stories WHERE id = $1`,
      [storyId]
    );

    // Retry once after short delay for transaction commit visibility
    if (storyResult.rows.length === 0) {
      console.warn(`[CMD DEBUG] Story not found, waiting 500ms for transaction visibility...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      storyResult = await query(
        `SELECT * FROM stories WHERE id = $1`,
        [storyId]
      );
      console.log(`[CMD DEBUG] Retry query returned ${storyResult.rows.length} rows`);
    }

    if (storyResult.rows.length === 0) {
      console.error(`Story not found after retry: ${storyId}`);
      return;
    }

    const story = storyResult.rows[0];

    // Fetch shot plan
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
      characters: row.characters || [],
      keyObjects: row.key_objects || [],
      keyActions: row.key_actions || [],
      audioCues: row.audio_cues,
      styleReferences: row.style_references,
      negativePrompts: row.negative_prompts,
      modelOverride: row.model_override,
      transition: row.transition ? (typeof row.transition === 'string' ? JSON.parse(row.transition) : row.transition) : undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    if (shots.length === 0) {
      console.warn(`No shots in shot plan for story: ${storyId}`);
      return;
    }

    // Filter shots if specific shotIds provided
    const shotsToDispatch = shotIds?.length
      ? shots.filter((s) => shotIds.includes(s.id))
      : shots;

    if (shotsToDispatch.length === 0) {
      console.warn(`No matching shots to dispatch for story: ${storyId}`);
      return;
    }

    // Fetch characters for Face-Lock conditioning
    const characters = await getCharacterReferences(storyId);

    // Dispatch shots with concurrency control
    const concurrencyLimit = this.handlerOptions.maxConcurrentDispatches;
    const dispatchQueue = [...shotsToDispatch];
    const self = this;

    async function dispatchNext(): Promise<void> {
      if (dispatchQueue.length === 0) return;

      const shot = dispatchQueue.shift()!;

      // Check if already dispatched (unless forced)
      if (!force && (await isShotDispatched(shot.id))) {
        console.log(`Shot ${shot.id} already dispatched, skipping`);
        return;
      }

      try {
        // Route model for this shot
        const routingDecision = await selectModelForShot(userId, {
          resolution: story.resolution as any,
          aspectRatio: story.aspect_ratio as any,
          durationSeconds: shot.durationSeconds,
          requiredCapabilities: ['text_to_video'],
        });

        const model = routingDecision.model;
        const fallbackModels = routingDecision.fallbackModels;

        // Compile prompt for the model
        const promptOutput = await compilePrompt(shot, characters, model, {
          maxPromptLength: 4000,
        });

        // Dispatch shot
        const dispatchResult = await dispatchShot(shot, promptOutput, model, {
          timeoutSeconds: self.handlerOptions.defaultTimeoutSeconds,
          skipAdmission: false, // Run admission for fresh dispatches
        });

        if (dispatchResult.success) {
          console.log(`Dispatched shot ${shot.id} to model ${model.id}`);
        } else {
          console.error(`Shot ${shot.id} dispatch failed: ${dispatchResult.error}`);
        }
      } catch (error) {
        console.error(`Failed to dispatch shot ${shot.id}:`, error);
        // Error will be captured by dispatchShot and shot status updated
      }
    };

    // Start concurrent dispatch workers
    const workers = Array.from({ length: Math.min(concurrencyLimit, shotsToDispatch.length) }, () =>
      (async () => {
        while (dispatchQueue.length > 0) {
          await dispatchNext();
        }
      })()
    );

    await Promise.all(workers);
  }

  /**
   * Handle 'regenerate_shots' command - partial regeneration
   */
  private async handleRegenerateShots(payload: StoryCommandPayload): Promise<void> {
    const { storyId, shotIds, userId, force = true } = payload;

    if (!shotIds?.length) {
      console.warn('regenerate_shots command requires shotIds');
      return;
    }

    console.log(`Partial regeneration for story ${storyId}, shots: ${shotIds.join(', ')}`);

    // Fetch story - retry for transaction visibility
    let storyResult = await query(
      `SELECT * FROM stories WHERE id = $1`,
      [storyId]
    );

    if (storyResult.rows.length === 0) {
      console.warn(`[CMD DEBUG] Story not found, waiting 500ms for transaction visibility...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      storyResult = await query(
        `SELECT * FROM stories WHERE id = $1`,
        [storyId]
      );
    }

    if (storyResult.rows.length === 0) {
      console.error(`Story not found after retry: ${storyId}`);
      return;
    }

    const story = storyResult.rows[0];

    // Fetch specific shots
    const shotsResult = await query(
      `SELECT * FROM shots WHERE story_id = $1 AND id = ANY($2) ORDER BY order_index`,
      [storyId, shotIds]
    );

    const shots: ShotPlan[] = shotsResult.rows.map(row => ({
      id: row.id,
      storyId: row.story_id,
      order: row.order_index,
      visualDescription: row.visual_description,
      durationSeconds: row.duration_seconds,
      cameraMotion: row.camera_motion,
      characters: row.characters || [],
      keyObjects: row.key_objects || [],
      keyActions: row.key_actions || [],
      audioCues: row.audio_cues,
      styleReferences: row.style_references,
      negativePrompts: row.negative_prompts,
      modelOverride: row.model_override,
      transition: row.transition ? (typeof row.transition === 'string' ? JSON.parse(row.transition) : row.transition) : undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    if (shots.length === 0) {
      console.warn(`No matching shots found for regeneration`);
      return;
    }

    // Fetch characters for Face-Lock conditioning
    const characters = await getCharacterReferences(storyId);

    // Dispatch each shot with regeneration flag
    for (const shot of shots) {
      try {
        // Route model (may use same or fallback model)
        const routingDecision = await selectModelForShot(userId, {
          resolution: story.resolution as any,
          aspectRatio: story.aspect_ratio as any,
          durationSeconds: shot.durationSeconds,
          requiredCapabilities: ['text_to_video'],
        });

        const model = routingDecision.model;
        const fallbackModels = routingDecision.fallbackModels;

        // Compile prompt - pass characters to preserve Face-Lock conditioning
        const promptOutput = await compilePrompt(shot, characters, model, {
          maxPromptLength: 4000,
        });

        // Dispatch with fallback models, skip admission (already passed)
        await dispatchWithFallback(
          shot,
          promptOutput,
          model,
          fallbackModels,
          {
            skipAdmission: true,
            timeoutSeconds: this.handlerOptions.defaultTimeoutSeconds,
            characters,
          }
        );

        console.log(`Regenerated shot ${shot.id} with model ${model.id}`);
      } catch (error) {
        console.error(`Failed to regenerate shot ${shot.id}:`, error);
      }
    }
  }
}

/**
 * Factory function to create a configured CommandHandlerConsumer
 */
export function createCommandHandlerConsumer(
  overrides: Partial<CommandHandlerOptions> = {}
): CommandHandlerConsumer {
  const defaults: CommandHandlerOptions = {
    consumerName: `command-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    count: 10,
    blockMs: 5000,
    minIdleTimeMs: 60000,
    claimCount: 10,
    claimStalled: true,
    maxConcurrentDispatches: 3,
    defaultTimeoutSeconds: 600,
  };

  return new CommandHandlerConsumer({ ...defaults, ...overrides });
}