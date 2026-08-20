/**
 * Unit tests for Event Bus and Story Lifecycle State Machine
 * Covers FR-031 (state change notifications), NFR-004 (RPO=0)
 */

import {
  StateMachine,
  STORY_TRANSITIONS,
  SHOT_TRANSITIONS,
  storyStateMachine,
  shotStateMachine,
  emitStoryStateChange,
  emitShotStateChange,
  emitCharacterStateChange,
  emitCrossShotConsistencyReport,
  initializeEventBus,
  closeEventBus,
} from '../../../src/shared/events';

jest.mock('../../../src/shared/redis', () => ({
  publishStoryEvent: jest.fn().mockResolvedValue('1-0'),
  initializeStreams: jest.fn().mockResolvedValue(undefined),
  closeRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/shared/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  transaction: jest.fn(),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, db: 0 },
    postgres: { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test', ssl: false, poolSize: 5 },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  redisCommandDurationSeconds: { observe: jest.fn() },
  redisConnectionGauge: { set: jest.fn() },
  dbQueryDurationSeconds: { observe: jest.fn() },
}));

jest.mock('../../../src/verification/faceLockVerification', () => ({
  generateCrossShotConsistencyReport: jest.fn().mockResolvedValue({
    storyId: 'story-2',
    generatedAt: new Date(),
    totalCharacters: 0,
    totalShots: 0,
    overallPassed: true,
    overallDriftDetected: false,
    characterSummaries: [],
    recommendations: [],
  }),
}));

const mockQuery = require('../../../src/shared/db').query;
const mockPublishStoryEvent = require('../../../src/shared/redis').publishStoryEvent;
const mockInitializeStreams = require('../../../src/shared/redis').initializeStreams;
const mockCloseRedis = require('../../../src/shared/redis').closeRedis;

// ============================================
// STORY_TRANSITIONS & SHOT_TRANSITIONS
// ============================================

describe('STORY_TRANSITIONS', () => {
  it('should be a non-empty array', () => {
    expect(Array.isArray(STORY_TRANSITIONS)).toBe(true);
    expect(STORY_TRANSITIONS.length).toBeGreaterThan(0);
  });

  it('each transition should have from, to, action', () => {
    for (const t of STORY_TRANSITIONS) {
      expect(t.from).toBeDefined();
      expect(t.to).toBeDefined();
      expect(t.action).toBeDefined();
    }
  });

  it('should include draft->planning transition', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'decompose_shots');
    expect(t).toBeDefined();
    expect(t!.from).toBe('draft');
    expect(t!.to).toBe('planning');
  });

  it('should include array-based from states for cancel', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'user_cancel');
    expect(t).toBeDefined();
    expect(Array.isArray(t!.from)).toBe(true);
    expect((t!.from as string[]).includes('draft')).toBe(true);
  });

  it('should include array-based from states for cost_guard_block', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'cost_guard_block');
    expect(t).toBeDefined();
    expect(Array.isArray(t!.from)).toBe(true);
    expect((t!.from as string[]).includes('in_progress')).toBe(true);
    expect((t!.from as string[]).includes('generating')).toBe(true);
    expect((t!.from as string[]).includes('merging')).toBe(true);
  });

  it('should include rate_limit_block from in_progress and generating', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'rate_limit_block');
    expect(t).toBeDefined();
    expect((t!.from as string[]).includes('in_progress')).toBe(true);
    expect((t!.from as string[]).includes('generating')).toBe(true);
  });

  it('should include sacred_guard_block from in_progress and generating', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'sacred_guard_block');
    expect(t).toBeDefined();
    expect((t!.from as string[]).includes('in_progress')).toBe(true);
    expect((t!.from as string[]).includes('generating')).toBe(true);
  });

  it('should include generation_failed from in_progress, generating, merging', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'generation_failed');
    expect(t).toBeDefined();
    expect((t!.from as string[]).includes('in_progress')).toBe(true);
    expect((t!.from as string[]).includes('generating')).toBe(true);
    expect((t!.from as string[]).includes('merging')).toBe(true);
  });

  it('should include user_approve_merge with sideEffects', () => {
    const t = STORY_TRANSITIONS.find((t) => t.action === 'user_approve_merge');
    expect(t).toBeDefined();
    expect(t!.sideEffects).toBeDefined();
    expect(t!.sideEffects!.length).toBeGreaterThan(0);
  });
});

describe('SHOT_TRANSITIONS', () => {
  it('should be a non-empty array', () => {
    expect(Array.isArray(SHOT_TRANSITIONS)).toBe(true);
    expect(SHOT_TRANSITIONS.length).toBeGreaterThan(0);
  });

  it('each transition should have from, to, action', () => {
    for (const t of SHOT_TRANSITIONS) {
      expect(t.from).toBeDefined();
      expect(t.to).toBeDefined();
      expect(t.action).toBeDefined();
    }
  });

  it('should include planned->awaiting_approval', () => {
    const t = SHOT_TRANSITIONS.find((t) => t.action === 'plan_presented');
    expect(t).toBeDefined();
    expect(t!.from).toBe('planned');
    expect(t!.to).toBe('awaiting_approval');
  });

  it('should include timeout->dispatched fallback', () => {
    const t = SHOT_TRANSITIONS.find((t) => t.action === 'fallback_dispatch');
    expect(t).toBeDefined();
    expect(t!.from).toBe('timeout');
    expect(t!.to).toBe('dispatched');
  });

  it('should include array from states for cancel_shot', () => {
    const t = SHOT_TRANSITIONS.find((t) => t.action === 'cancel_shot');
    expect(t).toBeDefined();
    expect(Array.isArray(t!.from)).toBe(true);
  });
});

// ============================================
// StateMachine class
// ============================================

describe('StateMachine', () => {
  describe('constructor and lookup', () => {
    it('should build transition lookup for single from states', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      const transitions = sm.getAllowedTransitions('draft');
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions.some((t) => t.action === 'decompose_shots')).toBe(true);
    });

    it('should build transition lookup for array from states', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      const transitions = sm.getAllowedTransitions('in_progress');
      expect(transitions.length).toBeGreaterThan(0);
    });
  });

  describe('getCurrentState', () => {
    it('should return undefined for unknown entity', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      expect(sm.getCurrentState('unknown')).toBeUndefined();
    });

    it('should return current state when set', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      expect(sm.getCurrentState('s1')).toBe('draft');
    });
  });

  describe('setCurrentState', () => {
    it('should set state for entity', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'planning');
      expect(sm.getCurrentState('s1')).toBe('planning');
    });

    it('should overwrite existing state', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      sm.setCurrentState('s1', 'planning');
      expect(sm.getCurrentState('s1')).toBe('planning');
    });
  });

  describe('getAllowedTransitions', () => {
    it('should return transitions for known state', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      const transitions = sm.getAllowedTransitions('draft');
      expect(transitions.length).toBeGreaterThanOrEqual(1);
      expect(transitions.some((t) => t.action === 'decompose_shots')).toBe(true);
    });

    it('should return empty array for state with no transitions', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      const transitions = sm.getAllowedTransitions('completed');
      expect(transitions).toEqual([]);
    });
  });

  describe('canTransition', () => {
    it('should return false if no current state', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      expect(sm.canTransition('unknown', 'decompose_shots')).toBe(false);
    });

    it('should return true for valid action', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      expect(sm.canTransition('s1', 'decompose_shots')).toBe(true);
    });

    it('should return false for invalid action', () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      expect(sm.canTransition('s1', 'invalid_action')).toBe(false);
    });
  });

  describe('transition', () => {
    it('should throw if no current state', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      await expect(sm.transition('unknown', 'decompose_shots')).rejects.toThrow(
        'No current state for story unknown'
      );
    });

    it('should throw if no valid transition for action', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      await expect(sm.transition('s1', 'invalid_action')).rejects.toThrow(
        'Invalid transition: draft --invalid_action--> ? for story s1'
      );
    });

    it('should perform valid transition and emit event', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      const result = await sm.transition('s1', 'decompose_shots');
      expect(result).toBe('planning');
      expect(sm.getCurrentState('s1')).toBe('planning');
      expect(emitFn).toHaveBeenCalledTimes(1);
      const event = emitFn.mock.calls[0][0];
      expect(event.entityType).toBe('story');
      expect(event.entityId).toBe('s1');
      expect(event.fromState).toBe('draft');
      expect(event.toState).toBe('planning');
      expect(event.metadata.action).toBe('decompose_shots');
      expect(event.metadata.userId).toBe('system');
    });

    it('should use custom userId', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      await sm.transition('s1', 'decompose_shots', {}, 'user123');
      const event = emitFn.mock.calls[0][0];
      expect(event.metadata.userId).toBe('user123');
    });

    it('should pass trace context to event', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      const traceCtx = { traceId: 'trace-1', spanId: 'span-1', parentSpanId: 'parent-1' };
      await sm.transition('s1', 'decompose_shots', {}, 'system', traceCtx);
      const event = emitFn.mock.calls[0][0];
      expect(event.traceId).toBe('trace-1');
      expect(event.parentSpanId).toBe('span-1');
      expect(event.spanId).toBeDefined();
    });

    it('should run side effects', async () => {
      const sideEffect = jest.fn().mockResolvedValue(undefined);
      const testTransitions = [
        { from: 'draft', to: 'planning', action: 'test', sideEffects: [sideEffect] },
      ];
      const emitFn = jest.fn();
      const sm = new StateMachine('story', testTransitions, emitFn);
      sm.setCurrentState('s1', 'draft');
      await sm.transition('s1', 'test');
      expect(sideEffect).toHaveBeenCalledTimes(1);
    });

    it('should run guards and throw if guard fails', async () => {
      const guard = jest.fn().mockResolvedValue(false);
      const testTransitions = [
        { from: 'draft', to: 'planning', action: 'test', guards: [guard] },
      ];
      const emitFn = jest.fn();
      const sm = new StateMachine('story', testTransitions, emitFn);
      sm.setCurrentState('s1', 'draft');
      await expect(sm.transition('s1', 'test')).rejects.toThrow('Guard failed');
    });

    it('should pass payload in context', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      const payload = { key: 'value' };
      await sm.transition('s1', 'decompose_shots', payload);
      const event = emitFn.mock.calls[0][0];
      expect(event.metadata.payload).toEqual(payload);
    });

    it('should set spanId on emitted event', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      sm.setCurrentState('s1', 'draft');
      await sm.transition('s1', 'decompose_shots');
      const event = emitFn.mock.calls[0][0];
      expect(event.spanId).toBeDefined();
    });
  });

  describe('loadState', () => {
    it('should return null by default', async () => {
      const emitFn = jest.fn();
      const sm = new StateMachine('story', STORY_TRANSITIONS, emitFn);
      const result = await sm.loadState('s1');
      expect(result).toBeNull();
    });
  });
});

// ============================================
// storyStateMachine
// ============================================

describe('storyStateMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storyStateMachine.setCurrentState('story-1', 'draft');
  });

  it('should be a StateMachine instance', () => {
    expect(storyStateMachine).toBeInstanceOf(StateMachine);
  });

  it('should emit event to db and redis on transition', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const result = await storyStateMachine.transition('story-1', 'decompose_shots');
    expect(result).toBe('planning');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('story');
    expect(event.entityId).toBe('story-1');
    expect(event.fromState).toBe('draft');
    expect(event.toState).toBe('planning');
  });
});

// ============================================
// shotStateMachine
// ============================================

describe('shotStateMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shotStateMachine.setCurrentState('shot-1', 'planned');
  });

  it('should be a StateMachine instance', () => {
    expect(shotStateMachine).toBeInstanceOf(StateMachine);
  });

  it('should emit event to db and redis on transition', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const result = await shotStateMachine.transition('shot-1', 'plan_presented');
    expect(result).toBe('awaiting_approval');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('shot');
    expect(event.entityId).toBe('shot-1');
  });
});

// ============================================
// emitStoryStateChange
// ============================================

describe('emitStoryStateChange', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should persist to db and publish to redis', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('story');
    expect(event.entityId).toBe('s1');
    expect(event.fromState).toBe('draft');
    expect(event.toState).toBe('planning');
    expect(event.metadata.action).toBe('decompose_shots');
  });

  it('should use default payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({});
    expect(event.metadata.userId).toBe('system');
  });

  it('should accept custom payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots', { foo: 'bar' }, 'user1');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({ foo: 'bar' });
    expect(event.metadata.userId).toBe('user1');
  });

  it('should pass trace context', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const traceCtx = { traceId: 't1', spanId: 's1', parentSpanId: 'p1' };
    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots', {}, 'system', traceCtx);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.traceId).toBe('t1');
    expect(event.parentSpanId).toBe('s1');
    expect(event.spanId).toBeDefined();
  });

  it('should generate unique event ids', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots');
    const id1 = mockPublishStoryEvent.mock.calls[0][0].id;

    await emitStoryStateChange('s2', 'draft', 'planning', 'decompose_shots');
    const id2 = mockPublishStoryEvent.mock.calls[1][0].id;

    expect(id1).not.toBe(id2);
  });

  it('should set timestamp', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitStoryStateChange('s1', 'draft', 'planning', 'decompose_shots');
    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

// ============================================
// emitShotStateChange
// ============================================

describe('emitShotStateChange', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should persist to db and publish to redis', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitShotStateChange('shot-1', 'planned', 'awaiting_approval', 'plan_presented');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('shot');
    expect(event.entityId).toBe('shot-1');
    expect(event.fromState).toBe('planned');
    expect(event.toState).toBe('awaiting_approval');
  });

  it('should use default payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitShotStateChange('shot-1', 'planned', 'awaiting_approval', 'plan_presented');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({});
    expect(event.metadata.userId).toBe('system');
  });

  it('should accept custom payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitShotStateChange('shot-1', 'planned', 'awaiting_approval', 'plan_presented', { data: 1 }, 'u1');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({ data: 1 });
    expect(event.metadata.userId).toBe('u1');
  });

  it('should pass trace context', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const traceCtx = { traceId: 't1', spanId: 's1', parentSpanId: 'p1' };
    await emitShotStateChange('shot-1', 'planned', 'awaiting_approval', 'plan_presented', {}, 'system', traceCtx);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.traceId).toBe('t1');
    expect(event.parentSpanId).toBe('s1');
  });

  it('should generate unique event ids', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitShotStateChange('s1', 'planned', 'awaiting_approval', 'plan_presented');
    const id1 = mockPublishStoryEvent.mock.calls[0][0].id;

    await emitShotStateChange('s2', 'planned', 'awaiting_approval', 'plan_presented');
    const id2 = mockPublishStoryEvent.mock.calls[1][0].id;

    expect(id1).not.toBe(id2);
  });
});

// ============================================
// emitCharacterStateChange
// ============================================

describe('emitCharacterStateChange', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should persist to db and publish to redis', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCharacterStateChange('char-1', 'inactive', 'active', 'register');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('character');
    expect(event.entityId).toBe('char-1');
    expect(event.fromState).toBe('inactive');
    expect(event.toState).toBe('active');
  });

  it('should use default payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCharacterStateChange('char-1', 'inactive', 'active', 'register');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({});
    expect(event.metadata.userId).toBe('system');
  });

  it('should accept custom payload and userId', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCharacterStateChange('char-1', 'inactive', 'active', 'register', { name: 'test' }, 'admin');

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload).toEqual({ name: 'test' });
    expect(event.metadata.userId).toBe('admin');
  });

  it('should pass trace context', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const traceCtx = { traceId: 't1', spanId: 's1', parentSpanId: 'p1' };
    await emitCharacterStateChange('char-1', 'inactive', 'active', 'register', {}, 'system', traceCtx);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.traceId).toBe('t1');
    expect(event.parentSpanId).toBe('s1');
  });

  it('should generate unique event ids', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCharacterStateChange('c1', 'inactive', 'active', 'register');
    const id1 = mockPublishStoryEvent.mock.calls[0][0].id;

    await emitCharacterStateChange('c2', 'inactive', 'active', 'register');
    const id2 = mockPublishStoryEvent.mock.calls[1][0].id;

    expect(id1).not.toBe(id2);
  });

  it('should set timestamp', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCharacterStateChange('char-1', 'inactive', 'active', 'register');
    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

// ============================================
// emitCrossShotConsistencyReport
// ============================================

describe('emitCrossShotConsistencyReport', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockReport = {
    storyId: 'story-1',
    generatedAt: new Date('2025-01-01'),
    totalCharacters: 2,
    totalShots: 5,
    overallPassed: true,
    overallDriftDetected: false,
    characterSummaries: [],
    recommendations: [{ type: 'info' as const, message: 'All good', priority: 'low' as const }],
  };

  it('should persist to db and publish to redis', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCrossShotConsistencyReport('story-1', mockReport);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublishStoryEvent).toHaveBeenCalledTimes(1);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.entityType).toBe('story');
    expect(event.entityId).toBe('story-1');
    expect(event.fromState).toBe('generating');
    expect(event.toState).toBe('completed');
    expect(event.metadata.action).toBe('cross_shot_consistency_report');
  });

  it('should include report details in event payload', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCrossShotConsistencyReport('story-1', mockReport);

    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.metadata.payload.storyId).toBe('story-1');
    expect(event.metadata.payload.totalCharacters).toBe(2);
    expect(event.metadata.payload.totalShots).toBe(5);
    expect(event.metadata.payload.overallPassed).toBe(true);
    expect(event.metadata.payload.overallDriftDetected).toBe(false);
  });

  it('should generate a unique event id', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCrossShotConsistencyReport('story-1', mockReport);
    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.id).toBeDefined();
    expect(typeof event.id).toBe('string');
  });

  it('should set timestamp', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    await emitCrossShotConsistencyReport('story-1', mockReport);
    const event = mockPublishStoryEvent.mock.calls[0][0];
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

// ============================================
// initializeEventBus / closeEventBus
// ============================================

describe('initializeEventBus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call initializeStreams', async () => {
    mockInitializeStreams.mockResolvedValue(undefined);
    await initializeEventBus();
    expect(mockInitializeStreams).toHaveBeenCalledTimes(1);
  });
});

describe('closeEventBus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call closeRedis', async () => {
    mockCloseRedis.mockResolvedValue(undefined);
    await closeEventBus();
    expect(mockCloseRedis).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// storyStateMachine: user_approve_merge sideEffect
// ============================================

describe('storyStateMachine: user_approve_merge sideEffect', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should run cross-shot consistency report sideEffect on user_approve_merge', async () => {
    storyStateMachine.setCurrentState('story-2', 'pending_merge');

    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const result = await storyStateMachine.transition('story-2', 'user_approve_merge');
    expect(result).toBe('merging');

    // The side effect calls query + publishStoryEvent again for the consistency report
    // The main transition emits 1 event, the sideEffect emits another
    expect(mockPublishStoryEvent.mock.calls.length).toBeGreaterThanOrEqual(2);

    const consistencyEvent = mockPublishStoryEvent.mock.calls
      .map((c: any[]) => c[0])
      .find((e: any) => e.metadata.action === 'cross_shot_consistency_report');
    expect(consistencyEvent).toBeDefined();
    expect(consistencyEvent.entityType).toBe('story');
    expect(consistencyEvent.entityId).toBe('story-2');
  });

  it('should handle error in cross-shot consistency report sideEffect gracefully', async () => {
    const { generateCrossShotConsistencyReport } = require('../../../src/verification/faceLockVerification');
    generateCrossShotConsistencyReport.mockRejectedValueOnce(new Error('Verification failed'));

    storyStateMachine.setCurrentState('story-3', 'pending_merge');

    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await storyStateMachine.transition('story-3', 'user_approve_merge');
    expect(result).toBe('merging');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate cross-shot consistency report for story story-3'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});

// ============================================
// Edge case: multiple transitions from same state
// ============================================

describe('multiple transitions from same state', () => {
  it('should pick the first matching transition for a given action', async () => {
    const emitFn = jest.fn();
    const transitions = [
      { from: 'draft', to: 'planning', action: 'go' },
      { from: 'draft', to: 'cancelled', action: 'go' },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    const result = await sm.transition('s1', 'go');
    expect(result).toBe('planning');
  });
});

// ============================================
// Transition with multiple guards
// ============================================

describe('multiple guards', () => {
  it('should run all guards sequentially', async () => {
    const emitFn = jest.fn();
    const guard1 = jest.fn().mockResolvedValue(true);
    const guard2 = jest.fn().mockResolvedValue(true);
    const transitions = [
      { from: 'draft', to: 'planning', action: 'test', guards: [guard1, guard2] },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    await sm.transition('s1', 'test');
    expect(guard1).toHaveBeenCalledTimes(1);
    expect(guard2).toHaveBeenCalledTimes(1);
  });

  it('should throw if second guard fails', async () => {
    const emitFn = jest.fn();
    const guard1 = jest.fn().mockResolvedValue(true);
    const guard2 = jest.fn().mockResolvedValue(false);
    const transitions = [
      { from: 'draft', to: 'planning', action: 'test', guards: [guard1, guard2] },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    await expect(sm.transition('s1', 'test')).rejects.toThrow('Guard failed');
    expect(guard1).toHaveBeenCalledTimes(1);
    expect(guard2).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// Transition with multiple sideEffects
// ============================================

describe('multiple sideEffects', () => {
  it('should run all side effects', async () => {
    const emitFn = jest.fn();
    const effect1 = jest.fn().mockResolvedValue(undefined);
    const effect2 = jest.fn().mockResolvedValue(undefined);
    const transitions = [
      { from: 'draft', to: 'planning', action: 'test', sideEffects: [effect1, effect2] },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    await sm.transition('s1', 'test');
    expect(effect1).toHaveBeenCalledTimes(1);
    expect(effect2).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// Synchronous guards
// ============================================

describe('synchronous guards', () => {
  it('should support synchronous guard functions', async () => {
    const emitFn = jest.fn();
    const guard = jest.fn().mockReturnValue(true);
    const transitions = [
      { from: 'draft', to: 'planning', action: 'test', guards: [guard] },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    await sm.transition('s1', 'test');
    expect(sm.getCurrentState('s1')).toBe('planning');
  });

  it('should throw for synchronous guard returning false', async () => {
    const emitFn = jest.fn();
    const guard = jest.fn().mockReturnValue(false);
    const transitions = [
      { from: 'draft', to: 'planning', action: 'test', guards: [guard] },
    ];
    const sm = new StateMachine('story', transitions, emitFn);
    sm.setCurrentState('s1', 'draft');

    await expect(sm.transition('s1', 'test')).rejects.toThrow('Guard failed');
  });
});

// ============================================
// StateMachine with shot transitions
// ============================================

describe('StateMachine with SHOT_TRANSITIONS', () => {
  let emitFn: any;
  let sm: any;

  beforeEach(() => {
    emitFn = jest.fn();
    sm = new StateMachine('shot', SHOT_TRANSITIONS, emitFn);
  });

  it('should allow planned -> awaiting_approval', async () => {
    sm.setCurrentState('s1', 'planned');
    const result = await sm.transition('s1', 'plan_presented');
    expect(result).toBe('awaiting_approval');
  });

  it('should allow awaiting_approval -> approved', async () => {
    sm.setCurrentState('s1', 'awaiting_approval');
    const result = await sm.transition('s1', 'plan_approved');
    expect(result).toBe('approved');
  });

  it('should allow approved -> in_admission', async () => {
    sm.setCurrentState('s1', 'approved');
    const result = await sm.transition('s1', 'start_admission');
    expect(result).toBe('in_admission');
  });

  it('should allow in_admission -> admission_passed', async () => {
    sm.setCurrentState('s1', 'in_admission');
    const result = await sm.transition('s1', 'admission_pass');
    expect(result).toBe('admission_passed');
  });

  it('should allow in_admission -> admission_failed', async () => {
    sm.setCurrentState('s1', 'in_admission');
    const result = await sm.transition('s1', 'admission_fail');
    expect(result).toBe('admission_failed');
  });

  it('should allow admission_passed -> dispatched', async () => {
    sm.setCurrentState('s1', 'admission_passed');
    const result = await sm.transition('s1', 'dispatch_to_model');
    expect(result).toBe('dispatched');
  });

  it('should allow dispatched -> generating', async () => {
    sm.setCurrentState('s1', 'dispatched');
    const result = await sm.transition('s1', 'model_accepted');
    expect(result).toBe('generating');
  });

  it('should allow generating -> completed', async () => {
    sm.setCurrentState('s1', 'generating');
    const result = await sm.transition('s1', 'generation_complete');
    expect(result).toBe('completed');
  });

  it('should allow generating -> failed', async () => {
    sm.setCurrentState('s1', 'generating');
    const result = await sm.transition('s1', 'generation_failed');
    expect(result).toBe('failed');
  });

  it('should allow generating -> timeout', async () => {
    sm.setCurrentState('s1', 'generating');
    const result = await sm.transition('s1', 'model_timeout');
    expect(result).toBe('timeout');
  });

  it('should allow timeout -> dispatched (fallback)', async () => {
    sm.setCurrentState('s1', 'timeout');
    const result = await sm.transition('s1', 'fallback_dispatch');
    expect(result).toBe('dispatched');
  });
});

// ============================================
// Full story lifecycle
// ============================================

describe('full story lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should complete draft -> planning -> awaiting_approval -> approved -> in_progress', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('lifecycle-1', 'draft');

    let result = await storyStateMachine.transition('lifecycle-1', 'decompose_shots');
    expect(result).toBe('planning');

    result = await storyStateMachine.transition('lifecycle-1', 'present_plan');
    expect(result).toBe('awaiting_approval');

    result = await storyStateMachine.transition('lifecycle-1', 'user_approve');
    expect(result).toBe('approved');

    result = await storyStateMachine.transition('lifecycle-1', 'start_generation');
    expect(result).toBe('in_progress');
  });

  it('should handle cost pause and resume', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('pause-1', 'in_progress');

    let result = await storyStateMachine.transition('pause-1', 'cost_guard_block');
    expect(result).toBe('paused_cost');

    result = await storyStateMachine.transition('pause-1', 'cost_guard_resolved');
    expect(result).toBe('in_progress');
  });

  it('should handle rate limit pause and resume', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('rate-1', 'in_progress');

    let result = await storyStateMachine.transition('rate-1', 'rate_limit_block');
    expect(result).toBe('paused_rate_limit');

    result = await storyStateMachine.transition('rate-1', 'rate_limit_resolved');
    expect(result).toBe('in_progress');
  });

  it('should handle sacred guard pause and resume', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('sacred-1', 'in_progress');

    let result = await storyStateMachine.transition('sacred-1', 'sacred_guard_block');
    expect(result).toBe('paused_sacred_guard');

    result = await storyStateMachine.transition('sacred-1', 'sacred_guard_resolved');
    expect(result).toBe('in_progress');
  });

  it('should handle cancellation from draft', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('cancel-1', 'draft');
    const result = await storyStateMachine.transition('cancel-1', 'user_cancel');
    expect(result).toBe('cancelled');
  });

  it('should handle cancellation from in_progress', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('cancel-2', 'in_progress');
    const result = await storyStateMachine.transition('cancel-2', 'user_cancel');
    expect(result).toBe('cancelled');
  });

  it('should handle failure from generating', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPublishStoryEvent.mockResolvedValue('1-0');

    storyStateMachine.setCurrentState('fail-1', 'generating');
    const result = await storyStateMachine.transition('fail-1', 'generation_failed');
    expect(result).toBe('failed');
  });
});
