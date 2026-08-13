/**
 * Transition System for Video Assembly
 * Implements FR-027, CL-014, CL-020
 * 0.5s crossfade default + FFmpeg filter overrides
 */

import type { TransitionConfig, TransitionType, Resolution, AspectRatio } from '../shared/types.js';

/**
 * Extended transition options for building FFmpeg filters
 */
export interface TransitionFilterOptions {
  /** Duration of the transition in seconds */
  durationSeconds: number;
  /** Offset from start of first video (typically durationA - transitionDuration) */
  offsetSeconds: number;
  /** Input label A (previous shot) */
  inputA: string;
  /** Input label B (next shot) */
  inputB: string;
  /** Output label */
  output: string;
  /** Target resolution for scaling */
  resolution?: Resolution;
  /** Target aspect ratio */
  aspectRatio?: AspectRatio;
  /** Transition type (optional - defaults to crossfade) */
  type?: TransitionType;
}

/**
 * Transition preset definition
 */
export interface TransitionPreset {
  name: string;
  type: TransitionType;
  description: string;
  defaultDuration: number;
  /** FFmpeg xfade transition name */
  ffmpegTransition: string;
  /** Additional filter parameters */
  params?: Record<string, string | number>;
}

/**
 * Built transition filter ready for use
 */
export interface BuiltTransition {
  filter: string;
  inputLabels: string[];
  outputLabel: string;
}

// ============================================
// Built-in Transition Presets
// ============================================

const TRANSITION_PRESETS: Record<string, TransitionPreset> = {
  crossfade: {
    name: 'crossfade',
    type: 'crossfade',
    description: 'Smooth crossfade between shots',
    defaultDuration: 0.5,
    ffmpegTransition: 'fade',
  },
  fade: {
    name: 'fade',
    type: 'fade',
    description: 'Fade to black then fade in next shot',
    defaultDuration: 0.5,
    ffmpegTransition: 'fade',
  },
  slide: {
    name: 'slide',
    type: 'slide',
    description: 'Slide transition (left to right)',
    defaultDuration: 1.0,
    ffmpegTransition: 'slidelossless',
  },
  slideLeft: {
    name: 'slideLeft',
    type: 'slide',
    description: 'Slide left transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'slideleft',
  },
  slideRight: {
    name: 'slideRight',
    type: 'slide',
    description: 'Slide right transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'slideright',
  },
  slideUp: {
    name: 'slideUp',
    type: 'slide',
    description: 'Slide up transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'slideup',
  },
  slideDown: {
    name: 'slideDown',
    type: 'slide',
    description: 'Slide down transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'slidedown',
  },
  zoom: {
    name: 'zoom',
    type: 'zoom',
    description: 'Zoom transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'zoom',
  },
  zoomIn: {
    name: 'zoomIn',
    type: 'zoom',
    description: 'Zoom in transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'zoomin',
  },
  zoomOut: {
    name: 'zoomOut',
    type: 'zoom',
    description: 'Zoom out transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'zoomout',
  },
  wipe: {
    name: 'wipe',
    type: 'wipe',
    description: 'Wipe left transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'wipeleft',
  },
  wipeRight: {
    name: 'wipeRight',
    type: 'wipe',
    description: 'Wipe right transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'wiperight',
  },
  wipeUp: {
    name: 'wipeUp',
    type: 'wipe',
    description: 'Wipe up transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'wipeup',
  },
  wipeDown: {
    name: 'wipeDown',
    type: 'wipe',
    description: 'Wipe down transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'wipedown',
  },
  circleOpen: {
    name: 'circleOpen',
    type: 'wipe',
    description: 'Circle open transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'circleopen',
  },
  circleClose: {
    name: 'circleClose',
    type: 'wipe',
    description: 'Circle close transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'circleclose',
  },
  pixelize: {
    name: 'pixelize',
    type: 'wipe',
    description: 'Pixelize transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'pixelize',
  },
  hlSlice: {
    name: 'hlSlice',
    type: 'wipe',
    description: 'Horizontal line slice transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'hlslice',
  },
  vlSlice: {
    name: 'vlSlice',
    type: 'wipe',
    description: 'Vertical line slice transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'vlslice',
  },
  distance: {
    name: 'distance',
    type: 'wipe',
    description: 'Distance transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'distance',
  },
  smooth: {
    name: 'smooth',
    type: 'wipe',
    description: 'Smooth transition',
    defaultDuration: 1.0,
    ffmpegTransition: 'smooth',
  },
};

/**
 * Get a transition preset by name
 */
export function getTransitionPreset(name: string): TransitionPreset | undefined {
  return TRANSITION_PRESETS[name];
}

/**
 * List all available transition presets
 */
export function listTransitionPresets(): TransitionPreset[] {
  return Object.values(TRANSITION_PRESETS);
}

/**
 * Validate a transition configuration
 */
export function validateTransitionConfig(config: TransitionConfig): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!config.type) {
    issues.push('Transition type is required');
  } else if (!getTransitionPreset(config.type)) {
    // Allow any custom type (FFmpeg xfade supports many), but track unknown types in issues
    issues.push(`Unknown transition type: ${config.type}. Using as custom FFmpeg xfade transition. Available presets: ${listTransitionPresets().map(p => p.name).join(', ')}`);
  }

  if (typeof config.durationSeconds !== 'number' || config.durationSeconds <= 0) {
    issues.push('Transition duration must be a positive number');
  }

  if (config.durationSeconds > 10) {
    issues.push('Transition duration should not exceed 10 seconds');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================
// Core Filter Building
// ============================================

/**
 * Build a single transition filter between two inputs
 */
export function buildTransitionFilter(options: TransitionFilterOptions): string {
  const {
    inputA,
    inputB,
    output,
    durationSeconds,
    offsetSeconds,
  } = options;

  // Get the transition type - default to crossfade/fade
  const preset = getTransitionPreset(options.type || 'crossfade');
  const ffmpegTransition = preset?.ffmpegTransition || 'fade';

  const filter = `[${inputA}][${inputB}]xfade=transition=${ffmpegTransition}:duration=${durationSeconds}:offset=${offsetSeconds}[${output}]`;

  return filter;
}

/**
 * Build scale filter for a video input to match target resolution and aspect ratio
 */
export function buildScaleFilter(
  index: number,
  inputLabel: string,
  outputLabel: string,
  resolution: Resolution,
  aspectRatio: AspectRatio
): string {
  const [targetW, targetH] = getResolutionDimensions(resolution);
  const [arW, arH] = aspectRatio.split(':').map(Number);

  return `[${inputLabel}]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1[${outputLabel}]`;
}

/**
 * Get resolution dimensions
 */
export function getResolutionDimensions(resolution: Resolution): [number, number] {
  switch (resolution) {
    case '720p':
      return [1280, 720];
    case '1080p':
      return [1920, 1080];
    case '4K':
      return [3840, 2160];
    default:
      return [1920, 1080];
  }
}

/**
 * Build complete filter complex for merging multiple shots with transitions
 * This is used by the merger to create the FFmpeg filter graph
 */
export function buildMergeFiltersWithTransitions(
  shots: Array<{ id: string; durationSeconds: number }>,
  transition: TransitionConfig,
  resolution: Resolution,
  aspectRatio: AspectRatio
): string {
  if (shots.length === 0) {
    throw new Error('At least one shot is required');
  }

  if (shots.length === 1) {
    // Single shot - just scale
    return buildScaleFilter(0, '0:v', 'outv', resolution, aspectRatio);
  }

  const filters: string[] = [];
  let lastOutput = 'v0';

  // First shot: scale
  filters.push(buildScaleFilter(0, '0:v', 'v0', resolution, aspectRatio));

  for (let i = 1; i < shots.length; i++) {
    const prevOutput = `v${i - 1}`;
    const currentInput = `${i}:v`;
    const scaledOutput = `v${i}_scaled`;
    const transitionOutput = `v${i}`;

    // Scale current shot
    filters.push(buildScaleFilter(i, currentInput, scaledOutput, resolution, aspectRatio));

    // Calculate offset: duration of previous shot minus transition duration
    const prevDuration = shots[i - 1].durationSeconds;
    const offsetSeconds = Math.max(0, prevDuration - transition.durationSeconds);

    // Apply transition
    const transitionFilter = buildTransitionFilter({
      inputA: prevOutput,
      inputB: scaledOutput,
      output: transitionOutput,
      type: transition.type,
      durationSeconds: transition.durationSeconds,
      offsetSeconds,
    });

    filters.push(transitionFilter);
    lastOutput = transitionOutput;
  }

  // Final output
  filters.push(`[${lastOutput}]copy[outv]`);

  return filters.join(';');
}

/**
 * Create transition config with defaults
 */
export function createTransitionConfig(type?: TransitionType, durationSeconds?: number): TransitionConfig {
  const preset = type ? getTransitionPreset(type) : getTransitionPreset('crossfade');
  return {
    type: type || 'crossfade',
    durationSeconds: durationSeconds || preset?.defaultDuration || 0.5,
  };
}

/**
 * Merge transition configs (global + per-shot overrides)
 */
export function mergeTransitionConfigs(
  global: TransitionConfig,
  shot?: TransitionConfig
): TransitionConfig {
  return {
    type: shot?.type || global.type || 'crossfade',
    durationSeconds: shot?.durationSeconds != null ? shot.durationSeconds : global.durationSeconds ?? 0.5,
  };
}