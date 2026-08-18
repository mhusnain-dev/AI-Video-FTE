/**
 * Quality preset defaults
 * These are safe defaults used when config.qualityPresets is not yet populated.
 * Task B4: Ultra Realistic quality preset
 */

import type { QualityPreset, QualityPresetConfig } from './types.js';

export const DEFAULT_QUALITY_PRESETS: Record<QualityPreset, QualityPresetConfig> = {
  draft: {
    quality: 'draft',
    costMultiplier: 0.5,
    maxResolution: '720p',
    maxRetries: 1,
    faceLockThreshold: 0.70,
  },
  standard: {
    quality: 'standard',
    costMultiplier: 1.0,
    maxResolution: '1080p',
    maxRetries: 2,
    faceLockThreshold: 0.75,
  },
  high: {
    quality: 'high',
    costMultiplier: 1.5,
    maxResolution: '1080p',
    maxRetries: 3,
    faceLockThreshold: 0.78,
  },
  ultra_realistic: {
    quality: 'ultra_realistic',
    costMultiplier: 2.5,
    maxResolution: '4K',
    maxRetries: 4,
    faceLockThreshold: 0.82,
  },
};

/**
 * Get quality preset config with fallback to defaults
 */
export function getQualityPreset(preset: QualityPreset, configPresets?: Record<QualityPreset, QualityPresetConfig>): QualityPresetConfig {
  if (configPresets && configPresets[preset]) {
    return configPresets[preset];
  }
  return DEFAULT_QUALITY_PRESETS[preset];
}
