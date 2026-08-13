/**
 * Prompt Compiler Service
 * Builds model-specific prompts with Face-Lock character identity conditioning
 * Implements FR-022, FR-023, CL-014, CL-015
 */

import { config } from '../shared/config.js';
import type {
  ShotPlan,
  CharacterRegistryEntry,
  ModelCapabilities,
  FaceLockConditioning,
  CompiledPrompt as SharedCompiledPrompt,
  CharacterConditioning,
} from '../shared/types.js';

export interface PromptCompilerOptions {
  includeNegativePrompt?: boolean;
  maxPromptLength?: number;
  stylePreset?: string;
  /** Current retry count for Face-Lock regeneration (used in conditioning) */
  retryCount?: number;
}

/**
 * Main prompt compilation function
 * Builds generation prompts per shot with character identity conditioning
 * Returns CompiledPrompt with multi-character Face-Lock conditioning (characterConditioning[])
 */
export async function compilePrompt(
  shot: ShotPlan,
  characters: CharacterRegistryEntry[],
  model: ModelCapabilities,
  options: PromptCompilerOptions = {}
): Promise<SharedCompiledPrompt> {
  const { includeNegativePrompt = true, maxPromptLength = 4000, stylePreset } = options;

  // Build base prompt from shot description
  let prompt = buildBasePrompt(shot, stylePreset);

  // Apply character identity conditioning (Face-Lock) - multi-character support
  const faceLockConditionings = await buildMultiFaceLockConditioning(shot, characters, model, options.retryCount);

  // Apply model-specific parameter mappings
  const parameters = mapParametersToModel(shot, model);

  // Handle reference images for characters in this shot
  const referenceImages = collectReferenceImages(shot, characters);

  // Truncate if needed
  if (prompt.length > maxPromptLength) {
    prompt = truncatePrompt(prompt, maxPromptLength);
  }

  // Build negative prompt
  let negativePrompt: string | undefined;
  if (includeNegativePrompt) {
    negativePrompt = buildNegativePrompt(shot, model);
  }

  // Convert FaceLockConditioning[] to CharacterConditioning[] for shared CompiledPrompt
  const characterConditioning: CharacterConditioning[] = faceLockConditionings.map(fc => ({
    characterName: fc.characterName,
    referenceImageBase64: fc.referenceImageBase64,
    modelSpecificParams: fc.modelSpecificParams,
  }));

  return {
    modelId: model.id,
    shotId: shot.id,
    prompt,
    negativePrompt,
    parameters,
    modelParams: parameters, // Alias for backward compatibility
    characterConditioning,
    styleReferences: shot.styleReferences || [],
  };
}

/**
 * Build base prompt from shot description
 */
function buildBasePrompt(shot: ShotPlan, stylePreset?: string): string {
  const parts: string[] = [];

  // Scene description (uses visualDescription from ShotPlan)
  if (shot.visualDescription) {
    parts.push(shot.visualDescription);
  }

  // Camera direction
  if (shot.cameraMotion) {
    parts.push(`Camera: ${shot.cameraMotion}`);
  }

  // Duration hint for video models
  if (shot.durationSeconds) {
    parts.push(`Duration: ${shot.durationSeconds} seconds`);
  }

  // Style preset
  if (stylePreset) {
    parts.push(`Style: ${stylePreset}`);
  }

  // Key objects
  if (shot.keyObjects && shot.keyObjects.length > 0) {
    parts.push(`Objects: ${shot.keyObjects.join(', ')}`);
  }

  // Key actions
  if (shot.keyActions && shot.keyActions.length > 0) {
    parts.push(`Actions: ${shot.keyActions.join(', ')}`);
  }

  // Audio cues
  if (shot.audioCues && shot.audioCues.length > 0) {
    parts.push(`Audio: ${shot.audioCues.join(', ')}`);
  }

  return parts.join('. ') + '.';
}

/**
 * Build Face-Lock conditioning for characters in this shot (legacy single-character)
 * Used for backward compatibility
 */
async function buildFaceLockConditioning(
  shot: ShotPlan,
  characters: CharacterRegistryEntry[],
  model: ModelCapabilities,
  retryCount: number = 0
): Promise<FaceLockConditioning> {
  // Find characters referenced in this shot (match by name in characters array)
  const shotCharacters = characters.filter(c =>
    shot.characters.includes(c.name)
  );

  if (shotCharacters.length === 0) {
    // No character in this shot - return empty conditioning
    return {
      characterId: '',
      characterName: '',
      referenceImageBase64: '',
      identityStrength: 0,
      consistencyThreshold: config.faceLock.defaultPerModelThresholds[model.id] || 0.75,
      maxRetries: config.faceLock.maxRetries || 3,
      modelSpecificParams: {},
    };
  }

  // For multi-character shots, use primary character (first in list)
  // Multi-character support would composite multiple conditionings
  const primaryCharacter = shotCharacters[0];

  // Get model-specific Face-Lock parameters (CL-015)
  const modelSpecificParams = getModelFaceLockParams(model.id, primaryCharacter, retryCount);

  // Use actual base64 image from character registry
  // CharacterRegistryEntry now stores referenceImageBase64 directly
  const referenceImageBase64 = primaryCharacter.referenceImageBase64 || primaryCharacter.referenceImageHash || '';

  const identityStrength = (primaryCharacter.metadata.identityStrength as number) ?? 0.8;

  return {
    characterId: primaryCharacter.id,
    characterName: primaryCharacter.name,
    referenceImageBase64,
    identityStrength,
    consistencyThreshold: config.faceLock.defaultPerModelThresholds[model.id] || 0.75,
    maxRetries: config.faceLock.maxRetries || 3,
    modelSpecificParams,
  };
}

/**
 * Build multi-character Face-Lock conditioning for all characters in a shot
 * Returns array of FaceLockConditioning for each character in the shot
 * This replaces the single-character buildFaceLockConditioning for Task 40
 */
export async function buildMultiFaceLockConditioning(
  shot: ShotPlan,
  characters: CharacterRegistryEntry[],
  model: ModelCapabilities,
  retryCount: number = 0
): Promise<FaceLockConditioning[]> {
  // Find characters referenced in this shot (match by name in characters array)
  const shotCharacters = characters.filter(c =>
    shot.characters.includes(c.name)
  );

  if (shotCharacters.length === 0) {
    // No character in this shot - return empty array
    return [];
  }

  // Build conditioning for ALL characters in the shot
  const conditionings: FaceLockConditioning[] = [];

  for (const character of shotCharacters) {
    const modelSpecificParams = getModelFaceLockParams(model.id, character, retryCount);

    // Use actual base64 image from character registry
    const referenceImageBase64 = character.referenceImageBase64 || character.referenceImageHash || '';

    const identityStrength = (character.metadata.identityStrength as number) ?? 0.8;

    conditionings.push({
      characterId: character.id,
      characterName: character.name,
      referenceImageBase64,
      identityStrength,
      consistencyThreshold: config.faceLock.defaultPerModelThresholds[model.id] || 0.75,
      maxRetries: config.faceLock.maxRetries || 3,
      modelSpecificParams,
    });
  }

  return conditionings;
}

/**
 * Get model-specific Face-Lock parameters (CL-015)
 * FIXED: Uses referenceImageBase64 instead of referenceImageHash for actual image conditioning
 * Includes retryCount for regeneration tracking
 */
function getModelFaceLockParams(modelId: string, character: CharacterRegistryEntry, retryCount: number = 0): Record<string, any> {
  const identityStrength = (character.metadata.identityStrength as number) ?? 0.8;
  const referenceImage = character.referenceImageBase64 || character.referenceImageHash || '';
  const baseParams = {
    reference_image: referenceImage,
    identity_scale: identityStrength,
    retry_count: retryCount,
  };

  // Model-specific parameter mappings
  switch (modelId) {
    case 'veo3-low':
    case 'veo3-high':
      return {
        ...baseParams,
        // Veo 3 uses 'subject_reference' for Face-Lock
        subject_reference: referenceImage,
        subject_strength: identityStrength,
        // Veo-specific: consistency guidance
        consistency_guidance: true,
      };

    case 'runway-gen3':
    case 'runway-gen3-turbo':
      return {
        ...baseParams,
        // Runway Gen-3 uses 'reference_images' array
        reference_images: [referenceImage],
        reference_strength: identityStrength,
        // Runway-specific: motion bucket for consistency
        motion_bucket: 50,
      };

    case 'pika-1.5':
      return {
        ...baseParams,
        // Pika uses 'character_reference'
        character_reference: referenceImage,
        character_weight: identityStrength,
      };

    case 'kling-v1':
    case 'kling-v1.5':
      return {
        ...baseParams,
        // Kling uses 'image_reference' with 'subject_consistency'
        image_reference: referenceImage,
        subject_consistency: identityStrength,
      };

    default:
      // Generic fallback
      return baseParams;
  }
}

/**
 * Map shot parameters to model-specific parameters (CL-018)
 */
function mapParametersToModel(shot: ShotPlan, model: ModelCapabilities): Record<string, any> {
  const params: Record<string, any> = {};

  // Duration
  if (shot.durationSeconds) {
    params.duration = shot.durationSeconds;
  }

  // Resolution
  if (model.maxResolution) {
    params.resolution = model.maxResolution;
  }

  // Aspect ratio
  // ShotPlan doesn't have aspectRatio directly, inherits from story
  // Default to 16:9 if not specified
  params.aspect_ratio = '16:9';

  // FPS - default to 24 if not specified
  params.fps = 24;

  // Camera motion
  if (shot.cameraMotion) {
    params.camera_motion = shot.cameraMotion;
  }

  // Transition (if specified)
  if (shot.transition) {
    params.transition = shot.transition;
  }

  // Model-specific parameter names
  return normalizeParameterNames(params, model.id);
}

/**
 * Normalize parameter names for specific model APIs
 */
function normalizeParameterNames(params: Record<string, any>, modelId: string): Record<string, any> {
  const normalized = { ...params };

  // Model-specific parameter name mappings
  const mappings: Record<string, Record<string, string>> = {
    'veo3-low': {
      duration: 'duration_seconds',
      resolution: 'output_resolution',
      aspect_ratio: 'aspect_ratio',
      fps: 'fps',
      camera_motion: 'camera_control',
    },
    'veo3-high': {
      duration: 'duration_seconds',
      resolution: 'output_resolution',
      aspect_ratio: 'aspect_ratio',
      fps: 'fps',
      camera_motion: 'camera_control',
    },
    'runway-gen3': {
      duration: 'duration',
      resolution: 'resolution',
      aspect_ratio: 'aspect_ratio',
      fps: 'fps',
      camera_motion: 'camera_motion',
    },
    'runway-gen3-turbo': {
      duration: 'duration',
      resolution: 'resolution',
      aspect_ratio: 'aspect_ratio',
      fps: 'fps',
      camera_motion: 'camera_motion',
    },
  };

  const modelMapping = mappings[modelId] || {};
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(normalized)) {
    const mappedKey = modelMapping[key] || key;
    result[mappedKey] = value;
  }

  return result;
}

/**
 * Collect reference images for characters in this shot
 */
function collectReferenceImages(shot: ShotPlan, characters: CharacterRegistryEntry[]): string[] {
  const images: string[] = [];

  // Character reference images (by name match)
  const shotCharacters = characters.filter(c =>
    shot.characters.includes(c.name)
  );

  for (const character of shotCharacters) {
    // CharacterRegistryEntry now stores referenceImageBase64 directly
    // Use base64 if available, fallback to hash
    const refImage = character.referenceImageBase64 || character.referenceImageHash;
    if (refImage) {
      images.push(refImage);
    }
  }

  return images;
}

/**
 * Build negative prompt
 */
function buildNegativePrompt(shot: ShotPlan, model: ModelCapabilities): string {
  const negatives: string[] = [
    'blurry', 'low quality', 'distorted', 'deformed',
    'bad anatomy', 'extra limbs', 'missing limbs',
    'watermark', 'text', 'logo', 'signature',
    'ugly', 'duplicate', 'morbid', 'mutilated',
  ];

  // Model-specific negative prompts
  if (model.id.startsWith('veo3')) {
    negatives.push('static camera', 'no motion');
  }

  if (model.id.startsWith('runway')) {
    negatives.push('flickering', 'temporal inconsistency');
  }

  // Shot-specific negatives from negativePrompts array
  if (shot.negativePrompts && shot.negativePrompts.length > 0) {
    negatives.push(...shot.negativePrompts);
  }

  return negatives.join(', ');
}

/**
 * Truncate prompt to max length while preserving key elements
 */
function truncatePrompt(prompt: string, maxLength: number): string {
  if (prompt.length <= maxLength) return prompt;

  // Split by sentences and keep most important
  const sentences = prompt.split('. ').filter(s => s.trim().length > 0);
  let result = '';

  for (const sentence of sentences) {
    if ((result + sentence + '. ').length > maxLength) break;
    result += sentence + '. ';
  }

  return result.trim();
}

/**
 * Compile prompts for all shots in a story (batch compilation)
 */
export async function compilePromptsForStory(
  shots: ShotPlan[],
  characters: CharacterRegistryEntry[],
  models: ModelCapabilities[],
  options: PromptCompilerOptions = {}
): Promise<Map<string, SharedCompiledPrompt[]>> {
  const result = new Map<string, SharedCompiledPrompt[]>();

  for (const shot of shots) {
    const shotPrompts: SharedCompiledPrompt[] = [];

    // For each model in fallback chain, compile a prompt
    for (const model of models) {
      if (supportsShotRequirements(model, shot)) {
        const compiled = await compilePrompt(shot, characters, model, options);
        shotPrompts.push(compiled);
      }
    }

    result.set(shot.id, shotPrompts);
  }

  return result;
}

/**
 * Check if model supports shot requirements
 */
function supportsShotRequirements(model: ModelCapabilities, shot: ShotPlan): boolean {
  // Check duration
  if (shot.durationSeconds && model.maxDurationSeconds) {
    if (shot.durationSeconds > model.maxDurationSeconds) return false;
  }

  // Check resolution
  // ShotPlan doesn't have resolution directly, inherits from story
  // We'll skip this check for now

  return true;
}

/**
 * Get the model-specific duration parameter key
 */
function getDurationParamKey(modelId: string): string {
  const durationKeys: Record<string, string> = {
    'veo3-low': 'duration_seconds',
    'veo3-high': 'duration_seconds',
    'runway-gen3': 'duration',
    'runway-gen3-turbo': 'duration',
    'pika-1.5': 'duration',
    'kling-v1': 'duration',
    'kling-v1.5': 'duration',
  };
  return durationKeys[modelId] || 'duration';
}

/**
 * Validate prompt for model compatibility
 * Updated to work with new CompiledPrompt format using characterConditioning[]
 */
export function validatePromptForModel(prompt: SharedCompiledPrompt, model: ModelCapabilities): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (prompt.prompt.length > 4000) {
    issues.push(`Prompt exceeds 4000 chars: ${prompt.prompt.length}`);
  }

  // Check if any character conditioning references a model that doesn't support image-to-video
  for (const conditioning of prompt.characterConditioning || []) {
    if (conditioning.referenceImageBase64 && !model.capabilities.includes('image_to_video')) {
      issues.push(`Model ${model.id} doesn't support image-to-video for Face-Lock character ${conditioning.characterName}`);
    }
  }

  // Check duration using model-specific parameter key
  const durationKey = getDurationParamKey(model.id);
  const paramDuration = prompt.parameters[durationKey];
  if (typeof paramDuration === 'number' && model.maxDurationSeconds) {
    if (paramDuration > model.maxDurationSeconds) {
      issues.push(`Duration ${paramDuration}s exceeds model max ${model.maxDurationSeconds}s`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}