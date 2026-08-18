/**
 * Deterministic Rule-Based Prompt Sanitizer
 * PII stripping, model constraint injection, injection pattern detection
 * NO LLM, NO AI — pure regex + rule-based
 */

import type { ModelConstraints, SanitizedPrompt } from '../shared/types.js';

// ============================================
// PII Detection Patterns
// ============================================

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  { name: 'phone_us', pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g, replacement: '[REDACTED_PHONE]' },
  { name: 'phone_intl', pattern: /\+\d{1,3}[-.\s]?\d{4,14}/g, replacement: '[REDACTED_PHONE]' },
  { name: 'ssn', pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g, replacement: '[REDACTED_CARD]' },
  { name: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
];

// ============================================
// Prompt Injection Patterns
// ============================================

const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'ignore_instructions', pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|guidelines?)/gi },
  { name: 'system_override', pattern: /\b(system\s*:\s*|system_prompt\s*:\s*|<\|system\|>|<\|im_start\|>system)/gi },
  { name: 'role_play', pattern: /(you\s+are\s+now\s+|act\s+as\s+if\s+|pretend\s+(you\s+are|to\s+be)|roleplay\s+as)/gi },
  { name: 'jailbreak_dan', pattern: /\b(dan\s+mode|do\s+anything\s+now|developer\s+mode|jailbreak)\b/gi },
  { name: 'output_manipulation', pattern: /(output\s+only|respond\s+only\s+with|return\s+just|print\s+only|no\s+other\s+text)/gi },
  { name: 'delimiter_escape', pattern: /(---+\s*(END|STOP|SYSTEM|USER|ASSISTANT)|\\n\\n\s*(SYSTEM|USER):)/gi },
  { name: 'encoded_payload', pattern: /(base64|hex\s*encoded|rot13|from_hex)\s*(payload|data|instruction)/gi },
  { name: 'recursive_instruction', pattern: /(repeat\s+after\s+me|copy\s+this\s+exactly|echo\s+the\s+following)/gi },
];

// ============================================
// Model Safety Instructions
// ============================================

const MODEL_SAFETY_INSTRUCTIONS: Record<string, string[]> = {
  default: [
    'Generate content that is appropriate and safe.',
    'Do not include harmful, illegal, or explicit content.',
    'Respect all subjects depicted in the prompt.',
  ],
  'veo3-low': [
    'Follow Google safety guidelines.',
    'Do not generate content depicting real public figures in misleading contexts.',
  ],
  'veo3-high': [
    'Follow Google safety guidelines.',
    'Do not generate content depicting real public figures in misleading contexts.',
    'Maintain temporal consistency across frames.',
  ],
  'runway-gen3': [
    'Follow RunwayML content policies.',
    'Avoid generating violent or graphic content.',
  ],
  'kie-veo3-fast': [
    'Follow KIE safety guidelines for video generation.',
  ],
  'kie-veo3-quality': [
    'Follow KIE safety guidelines for video generation.',
    'Maintain high visual fidelity.',
  ],
};

// ============================================
// Core Sanitization
// ============================================

/**
 * Strip PII from prompt text using regex patterns
 */
function stripPII(text: string): { cleaned: string; found: string[] } {
  const found: string[] = [];
  let cleaned = text;

  for (const pii of PII_PATTERNS) {
    if (pii.pattern.test(cleaned)) {
      found.push(pii.name);
      // Reset lastIndex for global patterns
      pii.pattern.lastIndex = 0;
      cleaned = cleaned.replace(pii.pattern, pii.replacement);
    }
  }

  return { cleaned, found: [...new Set(found)] };
}

/**
 * Detect prompt injection patterns
 */
function detectInjections(text: string): { detected: string[]; neutralized: string } {
  const detected: string[] = [];
  let neutralized = text;

  for (const injection of INJECTION_PATTERNS) {
    if (injection.pattern.test(text)) {
      detected.push(injection.name);
      // Reset lastIndex for global patterns
      injection.pattern.lastIndex = 0;
      // Neutralize by wrapping in [NEUTRALIZED: pattern_name] markers
      neutralized = neutralized.replace(injection.pattern, (match) => {
        return `[NEUTRALIZED_INPUT: "${match}"]`;
      });
    }
  }

  return { detected: [...new Set(detected)], neutralized };
}

/**
 * Append model-specific safety instructions
 */
function appendModelConstraints(text: string, modelId: string): string {
  const safetyInstructions = MODEL_SAFETY_INSTRUCTIONS[modelId] || MODEL_SAFETY_INSTRUCTIONS.default;
  const constraintBlock = safetyInstructions.join(' ');
  return `${text}\n\n[SAFETY_INSTRUCTIONS]: ${constraintBlock}`;
}

/**
 * Apply custom model constraints (forbidden patterns, required instructions)
 */
function applyCustomConstraints(text: string, constraints: ModelConstraints): string {
  let result = text;

  // Check forbidden patterns
  if (constraints.forbiddenPatterns) {
    for (const pattern of constraints.forbiddenPatterns) {
      const regex = new RegExp(pattern, 'gi');
      if (regex.test(result)) {
        result = result.replace(regex, '[FORBIDDEN_CONTENT_REMOVED]');
      }
    }
  }

  // Append required safety instructions
  if (constraints.requiredSafetyInstructions && constraints.requiredSafetyInstructions.length > 0) {
    result = `${result}\n\n[MODEL_SAFETY]: ${constraints.requiredSafetyInstructions.join(' ')}`;
  }

  // Enforce max length
  if (constraints.maxLength && result.length > constraints.maxLength) {
    result = result.substring(0, constraints.maxLength);
  }

  return result;
}

/**
 * Main sanitization function
 * Deterministic rule-based sanitization — no LLM, no AI
 */
export function sanitizePrompt(raw: string, modelConstraints: ModelConstraints): SanitizedPrompt {
  const warnings: string[] = [];
  let piiFound = false;
  let injectionsFound = false;

  // Step 1: Strip PII
  const { cleaned: piiCleaned, found: piiTypes } = stripPII(raw);
  if (piiTypes.length > 0) {
    piiFound = true;
    warnings.push(`PII detected and redacted: ${piiTypes.join(', ')}`);
  }

  // Step 2: Detect and neutralize injection patterns
  const { detected: injectionTypes, neutralized } = detectInjections(piiCleaned);
  if (injectionTypes.length > 0) {
    injectionsFound = true;
    warnings.push(`Prompt injection patterns detected and neutralized: ${injectionTypes.join(', ')}`);
  }

  // Step 3: Apply custom model constraints
  let sanitized = applyCustomConstraints(neutralized, modelConstraints);

  // Step 4: Append model-specific safety instructions
  sanitized = appendModelConstraints(sanitized, modelConstraints.modelId);

  return {
    sanitized,
    piiFound,
    injectionsFound,
    warnings,
  };
}
