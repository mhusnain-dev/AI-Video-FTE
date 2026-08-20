/**
 * Unit tests for Transition System (Phase 6.2 - Task 42)
 */

import {
  getTransitionPreset,
  listTransitionPresets,
  validateTransitionConfig,
  buildTransitionFilter,
  buildScaleFilter,
  buildMergeFiltersWithTransitions,
  createTransitionConfig,
  mergeTransitionConfigs,
  getResolutionDimensions,
  type TransitionPreset,
  type TransitionFilterOptions,
} from '@/merger/transitionSystem';
import type { TransitionConfig } from '@/shared/types';

describe('Transition System', () => {
  // ============================================
  // Preset Tests
  // ============================================

  describe('getTransitionPreset', () => {
    test('returns crossfade preset', () => {
      const preset = getTransitionPreset('crossfade');
      expect(preset).toBeDefined();
      expect(preset!.name).toBe('crossfade');
      expect(preset!.defaultDuration).toBe(0.5);
      expect(preset!.ffmpegTransition).toBe('fade');
    });

    test('returns slide preset', () => {
      const preset = getTransitionPreset('slide');
      expect(preset).toBeDefined();
      expect(preset!.name).toBe('slide');
      expect(preset!.defaultDuration).toBe(1.0);
      expect(preset!.ffmpegTransition).toBe('slidelossless');
    });

    test('returns zoom preset', () => {
      const preset = getTransitionPreset('zoom');
      expect(preset).toBeDefined();
      expect(preset!.ffmpegTransition).toBe('zoom');
    });

    test('returns wipe preset', () => {
      const preset = getTransitionPreset('wipe');
      expect(preset).toBeDefined();
      expect(preset!.ffmpegTransition).toBe('wipeleft');
    });

    test('returns undefined for unknown preset', () => {
      const preset = getTransitionPreset('unknown');
      expect(preset).toBeUndefined();
    });
  });

  describe('listTransitionPresets', () => {
    test('returns all presets', () => {
      const presets = listTransitionPresets();
      expect(presets.length).toBeGreaterThan(5);
      expect(presets.map(p => p.name)).toContain('crossfade');
      expect(presets.map(p => p.name)).toContain('slide');
      expect(presets.map(p => p.name)).toContain('zoom');
      expect(presets.map(p => p.name)).toContain('wipe');
    });

    test('each preset has required fields', () => {
      const presets = listTransitionPresets();
      for (const preset of presets) {
        expect(preset.name).toBeDefined();
        expect(preset.type).toBeDefined();
        expect(preset.description).toBeDefined();
        expect(preset.defaultDuration).toBeGreaterThan(0);
        expect(preset.ffmpegTransition).toBeDefined();
      }
    });
  });

  // ============================================
  // Validation Tests
  // ============================================

  describe('validateTransitionConfig', () => {
    test('validates correct config', () => {
      const config: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('validates slide config', () => {
      const config: TransitionConfig = { type: 'slide', durationSeconds: 1.0 };
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(true);
    });

    test('rejects missing type', () => {
      const config = { durationSeconds: 0.5 } as TransitionConfig;
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Transition type is required');
    });

    test('rejects negative duration', () => {
      const config: TransitionConfig = { type: 'crossfade', durationSeconds: -1 };
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('positive'))).toBe(true);
    });

    test('rejects zero duration', () => {
      const config: TransitionConfig = { type: 'crossfade', durationSeconds: 0 };
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(false);
    });

    test('warns on excessive duration', () => {
      const config: TransitionConfig = { type: 'crossfade', durationSeconds: 15 };
      const result = validateTransitionConfig(config);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('10 seconds'))).toBe(true);
    });

    test('allows custom transition types (unknown but valid)', () => {
      const config: TransitionConfig = { type: 'customTransition', durationSeconds: 1.0 };
      const result = validateTransitionConfig(config);
      // Custom types are allowed but tracked as an issue/warning
      expect(result.valid).toBe(false); // Not strictly valid because it's not a known preset
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]).toContain('customTransition');
      expect(result.issues[0]).toContain('Available presets');
    });
  });

  // ============================================
  // Filter Building Tests
  // ============================================

  describe('buildTransitionFilter', () => {
    test('builds crossfade filter', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: 'crossfade',
      } as TransitionFilterOptions);

      expect(filter).toContain('[v0][v1]');
      expect(filter).toContain('xfade=transition=fade');
      expect(filter).toContain('duration=0.5');
      expect(filter).toContain('offset=4.5');
      expect(filter).toContain('[v1]');
    });

    test('builds slide filter', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'slide',
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=slidelossless');
      expect(filter).toContain('duration=1');
    });

    test('builds zoom filter', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'zoom',
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=zoom');
    });

    test('builds wipe filter', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'wipe',
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=wipeleft');
    });

    test('uses fade as default for unknown type', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: 'unknown',
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=fade');
    });

    test('uses crossfade default when type is undefined', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=fade');
      expect(filter).toContain('duration=0.5');
    });

    test('uses crossfade default when type is empty string', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: '',
      } as TransitionFilterOptions);

      expect(filter).toContain('xfade=transition=fade');
    });
  });

  describe('buildScaleFilter', () => {
    test('builds scale filter for 1080p 16:9', () => {
      const filter = buildScaleFilter(0, '0:v', 'v0', '1080p', '16:9');

      expect(filter).toContain('[0:v]');
      expect(filter).toContain('scale=1920:1080');
      expect(filter).toContain('force_original_aspect_ratio=decrease');
      expect(filter).toContain('pad=1920:1080');
      expect(filter).toContain('setsar=1');
      expect(filter).toContain('[v0]');
    });

    test('builds scale filter for 4K 9:16', () => {
      const filter = buildScaleFilter(1, '1:v', 'v1', '4K', '9:16');

      expect(filter).toContain('scale=3840:2160');
      expect(filter).toContain('pad=3840:2160');
    });

    test('builds scale filter for 720p 1:1', () => {
      const filter = buildScaleFilter(2, '2:v', 'v2', '720p', '1:1');

      expect(filter).toContain('scale=1280:720');
      expect(filter).toContain('pad=1280:720');
    });
  });

  describe('getResolutionDimensions', () => {
    test('returns correct dimensions', () => {
      expect(getResolutionDimensions('720p')).toEqual([1280, 720]);
      expect(getResolutionDimensions('1080p')).toEqual([1920, 1080]);
      expect(getResolutionDimensions('4K')).toEqual([3840, 2160]);
    });

    test('defaults to 1080p for unknown', () => {
      expect(getResolutionDimensions('unknown' as any)).toEqual([1920, 1080]);
    });
  });

  // ============================================
  // Merge Filters Tests
  // ============================================

  describe('buildMergeFiltersWithTransitions', () => {
    const transition: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };

    test('single shot returns scale filter only', () => {
      const shots = [{ id: 'shot-1', durationSeconds: 5 }];
      const filter = buildMergeFiltersWithTransitions(shots, transition, '1080p', '16:9');

      expect(filter).toContain('[0:v]');
      expect(filter).toContain('scale=1920:1080');
      expect(filter).not.toContain('xfade');
      expect(filter).toContain('[outv]');
    });

    test('two shots includes one transition', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 5 },
        { id: 'shot-2', durationSeconds: 5 },
      ];
      const filter = buildMergeFiltersWithTransitions(shots, transition, '1080p', '16:9');

      // Two scale filters
      expect(filter.split('scale=').length).toBe(3);
      // One xfade transition
      expect(filter.split('xfade=').length).toBe(2);
      expect(filter).toContain('[outv]');
    });

    test('three shots includes two transitions', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 5 },
        { id: 'shot-2', durationSeconds: 5 },
        { id: 'shot-3', durationSeconds: 5 },
      ];
      const filter = buildMergeFiltersWithTransitions(shots, transition, '1080p', '16:9');

      expect(filter.split('scale=').length).toBe(4); // 3 shots
      expect(filter.split('xfade=').length).toBe(3); // 2 transitions
    });

    test('calculates offset correctly', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 5 },
        { id: 'shot-2', durationSeconds: 5 },
      ];
      const longTransition: TransitionConfig = { type: 'crossfade', durationSeconds: 1.0 };
      const filter = buildMergeFiltersWithTransitions(shots, longTransition, '1080p', '16:9');

      // offset = 5 - 1.0 = 4.0
      expect(filter).toContain('offset=4');
    });

    test('handles zero offset when transition longer than shot', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 2 },
        { id: 'shot-2', durationSeconds: 5 },
      ];
      const longTransition: TransitionConfig = { type: 'crossfade', durationSeconds: 5.0 };
      const filter = buildMergeFiltersWithTransitions(shots, longTransition, '1080p', '16:9');

      // offset = max(0, 2 - 5) = 0
      expect(filter).toContain('offset=0');
    });

    test('throws for empty shots array', () => {
      expect(() => {
        buildMergeFiltersWithTransitions([], transition, '1080p', '16:9');
      }).toThrow('At least one shot is required');
    });

    test('works with different resolutions', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 5 },
        { id: 'shot-2', durationSeconds: 5 },
      ];
      const filter = buildMergeFiltersWithTransitions(shots, transition, '4K', '16:9');

      expect(filter).toContain('scale=3840:2160');
      expect(filter).toContain('pad=3840:2160');
    });

    test('works with different aspect ratios', () => {
      const shots = [
        { id: 'shot-1', durationSeconds: 5 },
        { id: 'shot-2', durationSeconds: 5 },
      ];
      const filter = buildMergeFiltersWithTransitions(shots, transition, '1080p', '9:16');

      // Still scales to 1920x1080 but pads to match
      expect(filter).toContain('pad=1920:1080');
    });
  });

  // ============================================
  // Config Creation Tests
  // ============================================

  describe('createTransitionConfig', () => {
    test('creates config with defaults', () => {
      const config = createTransitionConfig();
      expect(config.type).toBe('crossfade');
      expect(config.durationSeconds).toBe(0.5);
    });

    test('creates config with custom type', () => {
      const config = createTransitionConfig('slide');
      expect(config.type).toBe('slide');
      expect(config.durationSeconds).toBe(1.0); // slide default
    });

    test('creates config with custom duration', () => {
      const config = createTransitionConfig('crossfade', 2.0);
      expect(config.type).toBe('crossfade');
      expect(config.durationSeconds).toBe(2.0);
    });

    test('creates config with unknown type uses fallback duration', () => {
      const config = createTransitionConfig('unknownType', 1.5);
      expect(config.type).toBe('unknownType');
      expect(config.durationSeconds).toBe(1.5);
    });

    test('creates config with unknown type and no duration uses crossfade default', () => {
      const config = createTransitionConfig('unknownType');
      expect(config.type).toBe('unknownType');
      expect(config.durationSeconds).toBe(0.5); // crossfade default
    });
  });

  describe('mergeTransitionConfigs', () => {
    test('uses shot config over global', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };
      const shot: TransitionConfig = { type: 'slide', durationSeconds: 1.0 };

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.type).toBe('slide');
      expect(merged.durationSeconds).toBe(1.0);
    });

    test('falls back to global for missing shot config', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };
      const shot = { type: 'slide' } as TransitionConfig; // no duration provided

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.type).toBe('slide');
      expect(merged.durationSeconds).toBe(0.5); // from global
    });

    test('uses global when shot is undefined', () => {
      const global: TransitionConfig = { type: 'zoom', durationSeconds: 2.0 };
      const merged = mergeTransitionConfigs(global, undefined);
      expect(merged.type).toBe('zoom');
      expect(merged.durationSeconds).toBe(2.0);
    });

    test('uses crossfade default when both global and shot are undefined/partial', () => {
      const global = { type: 'fade' } as TransitionConfig; // no duration
      const shot = { type: 'wipe' } as TransitionConfig; // no duration

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.type).toBe('wipe');
      expect(merged.durationSeconds).toBe(0.5); // default
    });

    test('shot duration of 0 is treated as provided (not fallback)', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };
      const shot: TransitionConfig = { type: 'slide', durationSeconds: 1.0 };

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.durationSeconds).toBe(1.0);
    });

    test('shot with explicit duration of 0 uses 0 not global', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };
      const shot: TransitionConfig = { type: 'slide', durationSeconds: 0 };

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.durationSeconds).toBe(0);
    });

    test('global with explicit duration 0 and no shot duration uses 0', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: 0 };
      const shot = { type: 'slide' } as TransitionConfig;

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.durationSeconds).toBe(0);
    });

    test('both global and shot with undefined duration uses default 0.5', () => {
      const global = {} as TransitionConfig;
      const shot = {} as TransitionConfig;

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.type).toBe('crossfade');
      expect(merged.durationSeconds).toBe(0.5);
    });

    test('global with null durationSeconds uses default', () => {
      const global: TransitionConfig = { type: 'crossfade', durationSeconds: null as any };
      const shot = { type: 'slide' } as TransitionConfig;

      const merged = mergeTransitionConfigs(global, shot);
      expect(merged.durationSeconds).toBe(0.5);
    });
  });
});