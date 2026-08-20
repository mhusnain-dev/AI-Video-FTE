import { describe, it, expect } from 'vitest';
import type {
  StoryStatus,
  ShotStatus,
  StoryBrief,
  TransitionConfig,
  PaginatedResponse,
} from './api';

describe('API type definitions', () => {
  it('StoryStatus includes all expected states', () => {
    const validStatuses: StoryStatus[] = [
      'draft', 'planning', 'awaiting_approval', 'approved',
      'in_progress', 'generating', 'pending_merge', 'merging',
      'completed', 'failed', 'cancelled',
      'paused_cost', 'paused_rate_limit', 'paused_sacred_guard',
    ];
    expect(validStatuses.length).toBe(14);
    // Verify type assignment works
    const status: StoryStatus = 'generating';
    expect(status).toBe('generating');
  });

  it('ShotStatus includes all expected states', () => {
    const validStatuses: ShotStatus[] = [
      'planned', 'awaiting_approval', 'approved',
      'in_admission', 'admission_passed', 'dispatched',
      'generating', 'completed', 'failed', 'timeout', 'regenerating',
    ];
    expect(validStatuses.length).toBe(11);
    const status: ShotStatus = 'dispatched';
    expect(status).toBe('dispatched');
  });

  it('StoryBrief accepts valid configuration', () => {
    const brief: StoryBrief = {
      narrative: 'A detective walks through rainy streets',
      targetDurationSeconds: 30,
      aspectRatio: '16:9',
      resolution: '1080p',
    };
    expect(brief.narrative).toBeTruthy();
    expect(brief.targetDurationSeconds).toBeGreaterThan(0);
  });

  it('TransitionConfig accepts valid types', () => {
    const validTypes: TransitionConfig['type'][] = [
      'crossfade', 'fade', 'slide', 'zoom', 'wipe', 'custom',
    ];
    expect(validTypes).toContain('crossfade');
    const config: TransitionConfig = {
      type: 'crossfade',
      durationSeconds: 0.5,
    };
    expect(config.durationSeconds).toBe(0.5);
  });

  it('PaginatedResponse has correct shape', () => {
    const response: PaginatedResponse<string> = {
      items: ['a', 'b'],
      total: 10,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };
    expect(response.items.length).toBe(2);
    expect(response.total).toBe(10);
  });
});
