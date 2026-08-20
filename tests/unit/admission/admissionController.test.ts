/**
 * Unit tests for Admission Controller
 * Targets: runAdmissionPipeline, checkStoryCreationAdmission,
 *          checkPostGenerationAdmission, resolvePause
 */

import { jest } from '@jest/globals';
import type { AdmissionContext } from '../../../src/shared/types';

// Mock db
jest.mock('../../../src/shared/db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

// Mock moderation gate
jest.mock('../../../src/admission/moderationGate', () => ({
  checkModeration: jest.fn(),
  recordModerationAudit: jest.fn(),
}));

// Mock sacred guard
jest.mock('../../../src/admission/sacredGuard', () => ({
  checkSacredGuard: jest.fn(),
}));

// Mock cost guard
jest.mock('../../../src/admission/costGuard', () => ({
  checkCostGuard: jest.fn(),
  recordCostGuardAudit: jest.fn(),
}));

// Mock rate limit gate
jest.mock('../../../src/admission/rateLimitGate', () => ({
  checkRateLimit: jest.fn(),
  recordRateLimitAudit: jest.fn(),
}));

// Mock events
jest.mock('../../../src/shared/events', () => ({
  shotStateMachine: {
    setCurrentState: jest.fn(),
    getCurrentState: jest.fn(),
  },
}));

// Mock metrics
jest.mock('../../../src/shared/metrics', () => ({
  admissionPipelineDurationSeconds: { observe: jest.fn() },
  admissionGateDecisionTotal: { inc: jest.fn() },
  sacredGuardBlockTotal: { inc: jest.fn() },
  costGuardPauseTotal: { inc: jest.fn() },
  rateLimitExceededTotal: { inc: jest.fn() },
}));

const mockQuery = require('../../../src/shared/db').query as jest.MockedFunction<any>;
const mockTransaction = require('../../../src/shared/db').transaction as jest.MockedFunction<any>;
const { checkModeration, recordModerationAudit } = require('../../../src/admission/moderationGate');
const { checkSacredGuard } = require('../../../src/admission/sacredGuard');
const { checkCostGuard, recordCostGuardAudit } = require('../../../src/admission/costGuard');
const { checkRateLimit, recordRateLimitAudit } = require('../../../src/admission/rateLimitGate');
const { shotStateMachine } = require('../../../src/shared/events');
const metrics = require('../../../src/shared/metrics');

const {
  runAdmissionPipeline,
  checkStoryCreationAdmission,
  checkPostGenerationAdmission,
  resolvePause,
} = require('../../../src/admission/admissionController');

function makeContext(overrides: Partial<AdmissionContext> = {}): AdmissionContext {
  return {
    storyId: 'story-1',
    shotId: 'shot-1',
    prompt: 'A beautiful sunset',
    referenceImages: [],
    modelId: 'veo3-low',
    userId: 'user-1',
    estimatedCost: 0.01,
    ...overrides,
  };
}

describe('admissionController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (fn: any) => {
      const client = { query: (jest.fn() as any).mockResolvedValue({ rows: [] }) };
      await fn(client);
    });
  });

  // =========================================================================
  // runAdmissionPipeline
  // =========================================================================
  describe('runAdmissionPipeline', () => {
    test('all gates pass → passed, shot status updated to admission_passed', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      const result = await runAdmissionPipeline(makeContext());

      expect(result.passed).toBe(true);
      expect(result.blockedAtGate).toBeUndefined();
      expect(result.results.moderation.blocked).toBe(false);
      expect(result.results.sacredGuard.blocked).toBe(false);
      expect(result.results.costGuard.paused).toBe(false);
      expect(result.results.rateLimit.allowed).toBe(true);

      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_passed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_passed'"),
        ['shot-1']
      );
    });

    test('metrics recorded for all gates on pass', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.admissionPipelineDurationSeconds.observe).toHaveBeenCalledTimes(4);
      expect(metrics.admissionGateDecisionTotal.inc).toHaveBeenCalledTimes(4);
    });

    test('moderation blocks → returns blockedAtGate moderation, no further gates run', async () => {
      checkModeration.mockResolvedValue({ blocked: true, reason: 'violence detected', category: 'violence' });
      recordModerationAudit.mockResolvedValue(undefined);

      const result = await runAdmissionPipeline(makeContext());

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('moderation');
      expect(result.results.moderation.blocked).toBe(true);
      expect(checkSacredGuard).not.toHaveBeenCalled();
      expect(checkCostGuard).not.toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_failed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_failed'"),
        ['violence detected', 'shot-1']
      );
    });

    test('sacred guard blocks → returns blockedAtGate sacred_guard', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: true, reason: 'sacred entity match', matchType: 'exact', matchedEntity: 'Prophet', confidence: 0.95 });

      const result = await runAdmissionPipeline(makeContext());

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('sacred_guard');
      expect(result.results.moderation.blocked).toBe(false);
      expect(result.results.sacredGuard.blocked).toBe(true);
      expect(checkCostGuard).not.toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_failed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_failed'"),
        ['sacred entity match', 'shot-1']
      );
    });

    test('sacred guard blocks → sacredGuardBlockTotal metric incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: true, reason: 'match', matchType: 'fuzzy', matchedEntity: 'Entity', confidence: 0.8 });

      await runAdmissionPipeline(makeContext());

      expect(metrics.sacredGuardBlockTotal.inc).toHaveBeenCalledWith({
        enforcement_point: 'pre_dispatch',
        match_type: 'fuzzy',
        model_id: 'veo3-low',
      });
    });

    test('sacred guard audit always written to admission_audit', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });

      await runAdmissionPipeline(makeContext());

      const sacredAuditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit') && call[1][2] === 'sacred_guard'
      );
      expect(sacredAuditCall).toBeDefined();
      expect(sacredAuditCall![1][3]).toBe('pass');
      expect(sacredAuditCall![1][4]).toBeUndefined();
    });

    test('cost guard pauses → returns blockedAtGate cost_guard with pausedReason', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: true, reason: 'User budget exceeded', estimatedCost: 0.05, userBudgetRemaining: 0 });
      recordCostGuardAudit.mockResolvedValue(undefined);

      const result = await runAdmissionPipeline(makeContext());

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('cost_guard');
      expect(result.pausedReason).toBe('User budget exceeded');
      expect(result.results.costGuard.paused).toBe(true);
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_failed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE stories SET status = 'paused_cost'"),
        ['story-1']
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_failed'"),
        ['User budget exceeded', 'shot-1']
      );
    });

    test('cost guard pauses → costGuardPauseTotal metric incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: true, reason: 'overrun' });
      recordCostGuardAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.costGuardPauseTotal.inc).toHaveBeenCalledWith({ reason: 'overrun' });
    });

    test('cost guard pauses with undefined reason → falls back to overrun', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: true, reason: undefined });
      recordCostGuardAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.costGuardPauseTotal.inc).toHaveBeenCalledWith({ reason: 'overrun' });
    });

    test('rate limit blocks → returns blockedAtGate rate_limit', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: false, reason: 'Model rate limit exceeded', scope: 'model' });
      recordRateLimitAudit.mockResolvedValue(undefined);

      const result = await runAdmissionPipeline(makeContext());

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('rate_limit');
      expect(result.results.rateLimit.allowed).toBe(false);
      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_failed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE stories SET status = 'paused_rate_limit'"),
        ['story-1']
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_failed'"),
        ['Model rate limit exceeded', 'shot-1']
      );
    });

    test('rate limit blocks → rateLimitExceededTotal metric incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: false, reason: 'exceeded', scope: 'user' });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.rateLimitExceededTotal.inc).toHaveBeenCalledWith({
        scope: 'user',
        model_id: 'veo3-low',
      });
    });

    test('rate limit blocks with undefined scope → falls back to model', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: false, reason: 'exceeded', scope: undefined });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.rateLimitExceededTotal.inc).toHaveBeenCalledWith({
        scope: 'model',
        model_id: 'veo3-low',
      });
    });

    test('sacred guard blocked=true with no matchType → falls back to unknown', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: true, reason: 'blocked', matchType: undefined });

      await runAdmissionPipeline(makeContext());

      expect(metrics.sacredGuardBlockTotal.inc).toHaveBeenCalledWith({
        enforcement_point: 'pre_dispatch',
        match_type: 'unknown',
        model_id: 'veo3-low',
      });
    });

    test('moderation passed with no category → reason_category is none', async () => {
      checkModeration.mockResolvedValue({ blocked: false, category: undefined });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.admissionGateDecisionTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ gate: 'moderation', decision: 'pass', reason_category: 'none' })
      );
    });

    test('cost guard not paused → costGuardPauseTotal NOT incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false, reason: undefined });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.costGuardPauseTotal.inc).not.toHaveBeenCalled();
    });

    test('rate limit allowed → rateLimitExceededTotal NOT incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.rateLimitExceededTotal.inc).not.toHaveBeenCalled();
    });

    test('sacred guard blocked=false → sacredGuardBlockTotal NOT incremented', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.sacredGuardBlockTotal.inc).not.toHaveBeenCalled();
    });

    test('context fields passed correctly to checkSacredGuard', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext({
        prompt: 'Test prompt',
        referenceImages: ['img1', 'img2'],
        modelId: 'veo3-high',
        userId: 'user-2',
        storyId: 'story-2',
      }));

      expect(checkSacredGuard).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        referenceImages: ['img1', 'img2'],
        modelId: 'veo3-high',
        userId: 'user-2',
        storyId: 'story-2',
        enforcementPoint: 'pre_dispatch',
      });
    });

    test('cost guard metric uses overrun category when reason present', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false, reason: 'overrun' });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.admissionGateDecisionTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ gate: 'cost_guard', decision: 'pass', reason_category: 'overrun' })
      );
    });

    test('cost guard metric uses none category when no reason', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false, reason: undefined });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.admissionGateDecisionTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ gate: 'cost_guard', decision: 'pass', reason_category: 'none' })
      );
    });

    test('rate limit metric uses scope in reason_category', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true, scope: undefined });
      recordRateLimitAudit.mockResolvedValue(undefined);

      await runAdmissionPipeline(makeContext());

      expect(metrics.admissionGateDecisionTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ gate: 'rate_limit', decision: 'pass', reason_category: 'none' })
      );
    });
  });

  // =========================================================================
  // checkStoryCreationAdmission
  // =========================================================================
  describe('checkStoryCreationAdmission', () => {
    test('delegates to runAdmissionPipeline with empty shotId', async () => {
      checkModeration.mockResolvedValue({ blocked: false });
      recordModerationAudit.mockResolvedValue(undefined);
      checkSacredGuard.mockResolvedValue({ blocked: false });
      checkCostGuard.mockResolvedValue({ blocked: false, paused: false });
      recordCostGuardAudit.mockResolvedValue(undefined);
      checkRateLimit.mockResolvedValue({ allowed: true });
      recordRateLimitAudit.mockResolvedValue(undefined);

      const result = await checkStoryCreationAdmission('story-9', 'user-9', 'Create a video', ['ref1'], 'veo3-low');

      expect(result.passed).toBe(true);
      expect(checkModeration).toHaveBeenCalledWith({
        storyId: 'story-9',
        shotId: '',
        prompt: 'Create a video',
        referenceImages: ['ref1'],
        modelId: 'veo3-low',
        userId: 'user-9',
        estimatedCost: 0,
      });
    });

    test('returns blocked result when moderation fails during story creation', async () => {
      checkModeration.mockResolvedValue({ blocked: true, reason: 'blocked content', category: 'violence' });
      recordModerationAudit.mockResolvedValue(undefined);

      const result = await checkStoryCreationAdmission('story-9', 'user-9', 'Violent prompt', [], 'veo3-low');

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('moderation');
    });
  });

  // =========================================================================
  // checkPostGenerationAdmission
  // =========================================================================
  describe('checkPostGenerationAdmission', () => {
    test('sacred guard passes → passed, audit written', async () => {
      checkSacredGuard.mockResolvedValue({ blocked: false });

      const result = await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1', 'frame2'], 'veo3-low');

      expect(result.passed).toBe(true);
      expect(result.blockedAtGate).toBeUndefined();
      expect(checkSacredGuard).toHaveBeenCalledWith({
        prompt: '',
        referenceImages: ['frame1', 'frame2'],
        modelId: 'veo3-low',
        userId: 'user-1',
        storyId: 'story-1',
        enforcementPoint: 'post_generation_audit',
      });
      const auditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit')
      );
      expect(auditCall).toBeDefined();
      expect(auditCall![1][3]).toBe('pass');
      expect(auditCall![1][5]).toBe('sacred_guard_post_gen');
    });

    test('sacred guard blocks → blocked, shot + story updated', async () => {
      checkSacredGuard.mockResolvedValue({
        blocked: true,
        reason: 'Visual sacred entity detected',
        matchType: 'visual_semantic',
        matchedEntity: 'Sacred Figure',
        confidence: 0.88,
      });

      const result = await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1'], 'veo3-low');

      expect(result.passed).toBe(false);
      expect(result.blockedAtGate).toBe('sacred_guard');
      expect(result.results.sacredGuard.blocked).toBe(true);
      expect(shotStateMachine.setCurrentState).toHaveBeenCalledWith('shot-1', 'admission_failed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'admission_failed'"),
        ['Visual sacred entity detected', 'shot-1']
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE stories SET status = 'paused_sacred_guard'"),
        ['story-1']
      );
    });

    test('audit includes frameCount and enforcementPoint', async () => {
      checkSacredGuard.mockResolvedValue({ blocked: false });

      await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['f1', 'f2', 'f3'], 'veo3-low');

      const auditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit')
      );
      const fullContext = JSON.parse(auditCall![1][7]);
      expect(fullContext.enforcementPoint).toBe('post_generation_audit');
      expect(fullContext.frameCount).toBe(3);
    });

    test('blocked audit includes rule_triggered with matchType', async () => {
      checkSacredGuard.mockResolvedValue({
        blocked: true,
        reason: 'match',
        matchType: 'exact',
        matchedEntity: 'Entity',
        confidence: 0.99,
      });

      await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1'], 'veo3-low');

      const auditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit')
      );
      expect(auditCall![1][6]).toBe('sacred_guard_exact');
    });

    test('unblocked audit has null rule_triggered', async () => {
      checkSacredGuard.mockResolvedValue({ blocked: false, matchType: undefined });

      await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1'], 'veo3-low');

      const auditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit')
      );
      expect(auditCall![1][6]).toBeNull();
    });

    test('returns fallback results with costGuard and rateLimit defaults', async () => {
      checkSacredGuard.mockResolvedValue({ blocked: false });

      const result = await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1'], 'veo3-low');

      expect(result.results.moderation.blocked).toBe(false);
      expect(result.results.costGuard.paused).toBe(false);
      expect(result.results.costGuard.estimatedCost).toBe(0);
      expect(result.results.costGuard.userBudgetRemaining).toBe(0);
      expect(result.results.costGuard.projectCeilingRemaining).toBe(0);
      expect(result.results.costGuard.committedSpendRemaining).toBe(0);
      expect(result.results.rateLimit.allowed).toBe(true);
    });

    test('blocked full_context includes matchType, matchedEntity, confidence', async () => {
      checkSacredGuard.mockResolvedValue({
        blocked: true,
        reason: 'blocked',
        matchType: 'visual_semantic',
        matchedEntity: 'Prophet',
        confidence: 0.92,
      });

      await checkPostGenerationAdmission('story-1', 'shot-1', 'user-1', ['frame1'], 'veo3-low');

      const auditCall = mockQuery.mock.calls.find(
        (call: any[]) => call[0].includes('INSERT INTO admission_audit')
      );
      const fullContext = JSON.parse(auditCall![1][7]);
      expect(fullContext.matchType).toBe('visual_semantic');
      expect(fullContext.matchedEntity).toBe('Prophet');
      expect(fullContext.confidence).toBe(0.92);
    });
  });

  // =========================================================================
  // resolvePause
  // =========================================================================
  describe('resolvePause', () => {
    test('throws when story not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(resolvePause('story-x', 'cancel', 'user-1')).rejects.toThrow('Story not found');
    });

    test('paused_cost + cancel → cancelled', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'cancel', 'user-1', { reason: 'user request' });

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_cost + reduce_scope → in_progress', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'reduce_scope', 'user-1');

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_cost + increase_budget → in_progress', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'increase_budget', 'user-1');

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_rate_limit → in_progress', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_rate_limit' }] });

      await resolvePause('story-1', 'rate_limit_resolved', 'user-1');

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_sacred_guard + sacred_guard_resolved → in_progress', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_sacred_guard' }] });

      await resolvePause('story-1', 'sacred_guard_resolved', 'user-1');

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_sacred_guard + cancel → cancelled', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_sacred_guard' }] });

      await resolvePause('story-1', 'cancel', 'user-1');

      expect(mockTransaction).toHaveBeenCalled();
    });

    test('paused_sacred_guard + invalid resolution → throws', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_sacred_guard' }] });

      await expect(resolvePause('story-1', 'reduce_scope', 'user-1')).rejects.toThrow(
        'Invalid resolution for sacred guard pause'
      );
    });

    test('non-paused status "in_progress" → throws', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] });

      await expect(resolvePause('story-1', 'cancel', 'user-1')).rejects.toThrow(
        'Story not in paused state: in_progress'
      );
    });

    test('non-paused status "completed" → throws', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });

      await expect(resolvePause('story-1', 'cancel', 'user-1')).rejects.toThrow(
        'Story not in paused state: completed'
      );
    });

    test('transaction updates story status and inserts story_event', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [{ id: 'shot-10' }] }), // SELECT pending shots
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'reduce_scope', 'user-1');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stories SET status'),
        expect.arrayContaining(['in_progress', 'story-1'])
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO story_events'),
        expect.arrayContaining(['story', 'story-1', 'pause_resolved_reduce_scope', 'paused_cost', 'in_progress'])
      );
    });

    test('transaction resumes pending shots when newStatus is in_progress', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [{ id: 'shot-10' }, { id: 'shot-11' }] }), // pending shots
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_rate_limit' }] });

      await resolvePause('story-1', 'rate_limit_resolved', 'user-1');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'approved'"),
        ['shot-10']
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE shots SET status = 'approved'"),
        ['shot-11']
      );
    });

    test('transaction does NOT resume shots when cancelled', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [{ id: 'shot-10' }] }), // pending shots (should not be reached)
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'cancel', 'user-1');

      const approvedUpdate = mockClient.query.mock.calls.find(
        (call: any[]) => call[0].includes("UPDATE shots SET status = 'approved'")
      );
      expect(approvedUpdate).toBeUndefined();
    });

    test('metadata and userId recorded in story_event', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_rate_limit' }] });

      await resolvePause('story-1', 'rate_limit_resolved', 'user-42', { extra: 'data' });

      const eventCall = mockClient.query.mock.calls[1];
      const payloadParam = eventCall[1][5];
      expect(JSON.parse(payloadParam)).toEqual({ extra: 'data' });
      const metadataParam = eventCall[1][6];
      expect(JSON.parse(metadataParam)).toEqual({ userId: 'user-42' });
    });

    test('default empty metadata when not provided', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'reduce_scope', 'user-1');

      const eventCall = mockClient.query.mock.calls[1];
      const payloadParam = eventCall[1][5];
      expect(JSON.parse(payloadParam)).toEqual({});
      const metadataParam = eventCall[1][6];
      expect(JSON.parse(metadataParam)).toEqual({ userId: 'user-1' });
    });

    test('paused_sacred_guard + cancel → newStatus is cancelled, not in_progress', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [] }), // SELECT pending shots (not reached for cancelled)
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_sacred_guard' }] });

      await resolvePause('story-1', 'cancel', 'user-1');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stories SET status'),
        ['cancelled', 'story-1']
      );
    });

    test('paused_cost + cancel → newStatus is cancelled', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'cancel', 'user-1');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stories SET status'),
        ['cancelled', 'story-1']
      );
    });

    test('pending shots query filters by story_id and admission_failed status', async () => {
      const mockClient = {
        query: (jest.fn() as any)
          .mockResolvedValueOnce({ rows: [] }) // UPDATE story
          .mockResolvedValueOnce({ rows: [] }) // INSERT event
          .mockResolvedValueOnce({ rows: [] }), // pending shots
      };
      mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));

      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'paused_cost' }] });

      await resolvePause('story-1', 'reduce_scope', 'user-1');

      const pendingQuery = mockClient.query.mock.calls[2];
      expect(pendingQuery[0]).toContain("status = 'admission_failed'");
      expect(pendingQuery[1]).toContain('story-1');
    });
  });
});
