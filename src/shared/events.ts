/**
 * Event bus and story lifecycle state machine
 * Implements FR-031 (state change notifications), NFR-004 (RPO=0)
 * All state transitions emit immutable events to Redis Streams and PostgreSQL
 */

import { EventEmitter } from 'events';
import { publishStoryEvent, initializeStreams, closeRedis } from './redis.js';
import { query, transaction } from './db.js';
import type { StateChangeEvent, Story, StoryStatus, ShotPlan, ShotStatus } from './types.js';
import { config } from './config.js';

// ============================================
// State Machine Definitions
// ============================================

export type StoryState = StoryStatus;
export type ShotState = ShotStatus;

export interface StateTransition<State> {
  from: State | State[];
  to: State;
  action: string;
  guards?: StateGuard<State>[];
  sideEffects?: StateSideEffect<State>[];
}

export type StateGuard<State> = (context: StateContext<State>) => Promise<boolean> | boolean;
export type StateSideEffect<State> = (context: StateContext<State>) => Promise<void> | void;

export interface StateContext<State> {
  entityId: string;
  entityType: 'story' | 'shot' | 'character';
  fromState: State;
  toState: State;
  payload: Record<string, any>;
  userId: string;
  timestamp: Date;
  /** Root trace identifier for distributed tracing (generated at story creation) */
  traceId?: string;
  /** Current span identifier */
  spanId?: string;
  /** Parent span identifier for child operations */
  parentSpanId?: string;
}

// Story state transitions (FR-001 through FR-004, FR-031)
export const STORY_TRANSITIONS: StateTransition<StoryState>[] = [
  { from: 'draft', to: 'planning', action: 'decompose_shots' },
  { from: 'planning', to: 'awaiting_approval', action: 'present_plan' },
  { from: 'awaiting_approval', to: 'approved', action: 'user_approve' },
  { from: 'awaiting_approval', to: 'planning', action: 'user_revise' },
  { from: 'approved', to: 'in_progress', action: 'start_generation' },
  { from: 'in_progress', to: 'generating', action: 'dispatch_shots' },
  { from: 'generating', to: 'pending_merge', action: 'all_shots_completed' },
  {
    from: 'pending_merge',
    to: 'merging',
    action: 'user_approve_merge',
    sideEffects: [async (context) => {
      // Generate cross-shot Face-Lock consistency report (Task 39)
      try {
        const { generateCrossShotConsistencyReport } = await import('../verification/faceLockVerification.js');
        const report = await generateCrossShotConsistencyReport(context.entityId);
        await emitCrossShotConsistencyReport(context.entityId, report);
        console.log(`Cross-shot consistency report generated for story ${context.entityId}`);
      } catch (error) {
        console.error(`Failed to generate cross-shot consistency report for story ${context.entityId}:`, error);
      }
    }]
  },
  { from: 'merging', to: 'completed', action: 'merge_complete' },
  { from: ['in_progress', 'generating', 'merging'], to: 'paused_cost', action: 'cost_guard_block' },
  { from: ['in_progress', 'generating'], to: 'paused_rate_limit', action: 'rate_limit_block' },
  { from: ['in_progress', 'generating'], to: 'paused_sacred_guard', action: 'sacred_guard_block' },
  { from: 'paused_cost', to: 'in_progress', action: 'cost_guard_resolved' },
  { from: 'paused_rate_limit', to: 'in_progress', action: 'rate_limit_resolved' },
  { from: 'paused_sacred_guard', to: 'in_progress', action: 'sacred_guard_resolved' },
  { from: ['draft', 'planning', 'awaiting_approval', 'approved', 'in_progress', 'generating', 'merging', 'paused_cost', 'paused_rate_limit', 'paused_sacred_guard'], to: 'cancelled', action: 'user_cancel' },
  { from: ['in_progress', 'generating', 'merging'], to: 'failed', action: 'generation_failed' },
];

// Shot state transitions (FR-016 through FR-021)
export const SHOT_TRANSITIONS: StateTransition<ShotState>[] = [
  { from: 'planned', to: 'awaiting_approval', action: 'plan_presented' },
  { from: 'awaiting_approval', to: 'approved', action: 'plan_approved' },
  { from: 'approved', to: 'in_admission', action: 'start_admission' },
  { from: 'in_admission', to: 'admission_passed', action: 'admission_pass' },
  { from: 'in_admission', to: 'admission_failed', action: 'admission_fail' },
  { from: 'admission_passed', to: 'dispatched', action: 'dispatch_to_model' },
  { from: 'dispatched', to: 'generating', action: 'model_accepted' },
  { from: 'generating', to: 'completed', action: 'generation_complete' },
  { from: 'generating', to: 'failed', action: 'generation_failed' },
  { from: 'generating', to: 'timeout', action: 'model_timeout' },
  { from: 'timeout', to: 'dispatched', action: 'fallback_dispatch' },
  { from: ['planned', 'awaiting_approval', 'approved', 'in_admission', 'admission_passed', 'dispatched', 'generating'], to: 'cancelled', action: 'cancel_shot' },
];

const ALL_STORY_STATES: StoryState[] = [
  'draft', 'planning', 'awaiting_approval', 'approved', 'in_progress',
  'generating', 'merging', 'completed', 'failed', 'cancelled',
  'paused_cost', 'paused_rate_limit', 'paused_sacred_guard'
];

const ALL_SHOT_STATES: ShotState[] = [
  'planned', 'awaiting_approval', 'approved', 'in_admission', 'admission_passed',
  'admission_failed', 'dispatched', 'generating', 'completed', 'failed', 'cancelled',
  'timeout', 'face_lock_failed'
];

// ============================================
// State Machine Class
// ============================================

export class StateMachine<State extends string> {
  private transitions: Map<string, StateTransition<State>[]> = new Map();
  private currentState: Map<string, State> = new Map();

  constructor(
    private entityType: 'story' | 'shot' | 'character',
    transitions: StateTransition<State>[],
    private emitEvent: (event: StateChangeEvent) => Promise<void>
  ) {
    // Build transition lookup: from -> allowed transitions
    for (const t of transitions) {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      for (const from of fromStates) {
        if (!this.transitions.has(from)) {
          this.transitions.set(from, []);
        }
        this.transitions.get(from)!.push(t);
      }
    }
  }

  getCurrentState(entityId: string): State | undefined {
    return this.currentState.get(entityId);
  }

  setCurrentState(entityId: string, state: State): void {
    this.currentState.set(entityId, state);
  }

  getAllowedTransitions(fromState: State): StateTransition<State>[] {
    return this.transitions.get(fromState) || [];
  }

  canTransition(entityId: string, action: string): boolean {
    const currentState = this.currentState.get(entityId);
    if (!currentState) return false;
    return this.getAllowedTransitions(currentState).some(t => t.action === action);
  }

  async transition(
    entityId: string,
    action: string,
    payload: Record<string, any> = {},
    userId: string = 'system',
    traceContext?: { traceId?: string; spanId?: string; parentSpanId?: string }
  ): Promise<State> {
    const currentState = this.currentState.get(entityId);
    if (!currentState) {
      throw new Error(`No current state for ${this.entityType} ${entityId}`);
    }

    const transitions = this.getAllowedTransitions(currentState).filter(t => t.action === action);
    if (transitions.length === 0) {
      throw new Error(`Invalid transition: ${currentState} --${action}--> ? for ${this.entityType} ${entityId}`);
    }

    const transition = transitions[0];
    const context: StateContext<State> = {
      entityId,
      entityType: this.entityType,
      fromState: currentState,
      toState: transition.to,
      payload,
      userId,
      timestamp: new Date(),
      traceId: traceContext?.traceId,
      spanId: traceContext?.spanId,
      parentSpanId: traceContext?.parentSpanId,
    };

    // Run guards
    if (transition.guards) {
      for (const guard of transition.guards) {
        const allowed = await guard(context);
        if (!allowed) {
          throw new Error(`Guard failed for transition ${action} on ${this.entityType} ${entityId}`);
        }
      }
    }

    // Run side effects
    if (transition.sideEffects) {
      for (const effect of transition.sideEffects) {
        await effect(context);
      }
    }

    // Update state
    this.currentState.set(entityId, transition.to);

    // Generate span ID for this transition
    const spanId = crypto.randomUUID();

    // Emit event
    const event: StateChangeEvent = {
      id: crypto.randomUUID(),
      entityType: this.entityType,
      entityId,
      fromState: currentState,
      toState: transition.to,
      timestamp: context.timestamp,
      metadata: { action, payload, userId },
      traceId: traceContext?.traceId,
      spanId,
      parentSpanId: traceContext?.spanId,
    };

    await this.emitEvent(event);

    return transition.to;
  }

  // Load state from database (for recovery)
  async loadState(entityId: string): Promise<State | null> {
    // This would query the database for current state
    // Implemented in subclasses
    return null;
  }
}

// ============================================
// Story State Machine
// ============================================

export const storyStateMachine = new StateMachine<StoryState>(
  'story',
  STORY_TRANSITIONS,
  async (event) => {
    // Persist to PostgreSQL (immutable event log)
    await query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.entityType, event.entityId, event.metadata.action, event.fromState, event.toState,
       JSON.stringify(event.metadata.payload), JSON.stringify({ userId: event.metadata.userId })]
    );

    // Publish to Redis Stream for real-time consumers
    await publishStoryEvent(event);
  }
);

// ============================================
// Shot State Machine
// ============================================

export const shotStateMachine = new StateMachine<ShotState>(
  'shot',
  SHOT_TRANSITIONS,
  async (event) => {
    await query(
      `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.entityType, event.entityId, event.metadata.action, event.fromState, event.toState,
       JSON.stringify(event.metadata.payload), JSON.stringify({ userId: event.metadata.userId })]
    );

    await publishStoryEvent(event);
  }
);

// ============================================
// High-level State Change Functions (FR-031)
// ============================================

export async function emitStoryStateChange(
  storyId: string,
  fromState: StoryState,
  toState: StoryState,
  action: string,
  payload: Record<string, any> = {},
  userId: string = 'system',
  traceContext?: { traceId?: string; spanId?: string; parentSpanId?: string }
): Promise<void> {
  const spanId = crypto.randomUUID();
  const event: StateChangeEvent = {
    id: crypto.randomUUID(),
    entityType: 'story',
    entityId: storyId,
    fromState,
    toState,
    timestamp: new Date(),
    metadata: { action, payload, userId },
    traceId: traceContext?.traceId,
    spanId,
    parentSpanId: traceContext?.spanId,
  };

  // Persist to PostgreSQL
  await query(
    `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['story', storyId, action, fromState, toState, JSON.stringify(payload), JSON.stringify({ userId })]
  );

  // Publish to Redis Stream
  await publishStoryEvent(event);
}

export async function emitShotStateChange(
  shotId: string,
  fromState: ShotState,
  toState: ShotState,
  action: string,
  payload: Record<string, any> = {},
  userId: string = 'system',
  traceContext?: { traceId?: string; spanId?: string; parentSpanId?: string }
): Promise<void> {
  const spanId = crypto.randomUUID();
  const event: StateChangeEvent = {
    id: crypto.randomUUID(),
    entityType: 'shot',
    entityId: shotId,
    fromState,
    toState,
    timestamp: new Date(),
    metadata: { action, payload, userId },
    traceId: traceContext?.traceId,
    spanId,
    parentSpanId: traceContext?.spanId,
  };

  await query(
    `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['shot', shotId, action, fromState, toState, JSON.stringify(payload), JSON.stringify({ userId })]
  );

  await publishStoryEvent(event);
}

export async function emitCharacterStateChange(
  characterId: string,
  fromState: string,
  toState: string,
  action: string,
  payload: Record<string, any> = {},
  userId: string = 'system',
  traceContext?: { traceId?: string; spanId?: string; parentSpanId?: string }
): Promise<void> {
  const spanId = crypto.randomUUID();
  const event: StateChangeEvent = {
    id: crypto.randomUUID(),
    entityType: 'character',
    entityId: characterId,
    fromState,
    toState,
    timestamp: new Date(),
    metadata: { action, payload, userId },
    traceId: traceContext?.traceId,
    spanId,
    parentSpanId: traceContext?.spanId,
  };

  await query(
    `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['character', characterId, action, fromState, toState, JSON.stringify(payload), JSON.stringify({ userId })]
  );

  await publishStoryEvent(event);
}

/**
 * Emit cross-shot Face-Lock consistency report event (Task 39)
 * Called after story completion to report character consistency across all shots
 */
export async function emitCrossShotConsistencyReport(
  storyId: string,
  report: import('./types.js').CrossShotConsistencyReport
): Promise<void> {
  const event: StateChangeEvent = {
    id: crypto.randomUUID(),
    entityType: 'story',
    entityId: storyId,
    fromState: 'generating',
    toState: 'completed',
    timestamp: new Date(),
    metadata: {
      action: 'cross_shot_consistency_report',
      payload: {
        storyId: report.storyId,
        generatedAt: report.generatedAt,
        totalCharacters: report.totalCharacters,
        totalShots: report.totalShots,
        overallPassed: report.overallPassed,
        overallDriftDetected: report.overallDriftDetected,
        characterSummaries: report.characterSummaries,
        recommendations: report.recommendations,
      },
      userId: 'system',
    },
  };

  await query(
    `INSERT INTO story_events (entity_type, entity_id, event_type, from_state, to_state, payload, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['story', storyId, 'cross_shot_consistency_report', 'generating', 'completed',
     JSON.stringify(report), JSON.stringify({ userId: 'system' })]
  );

  await publishStoryEvent(event);
}

// ============================================
// Initialization
// ============================================

export async function initializeEventBus(): Promise<void> {
  await initializeStreams();
  console.log('Event bus initialized');
}

export async function closeEventBus(): Promise<void> {
  await closeRedis();
}