/**
 * Chat Co-Working API Routes
 * POST /api/stories/:id/chat - Send message, returns streaming SSE
 * GET /api/stories/:id/conversation - Fetch summaries + key decisions
 * GET /api/stories/:id/chat/stream - SSE stream for token streaming
 */

import express, { Request, Response } from 'express';
import { param, body, query as queryValidator, validationResult } from 'express-validator';
import { query } from '../shared/db.js';
import { getRedis, STREAMS } from '../shared/redis.js';
import { config } from '../shared/config.js';
import type { LLMProviderName } from './providers/llmProvider.js';
import { GeminiProvider } from './providers/geminiProvider.js';
import { NvidiaProvider } from './providers/nvidiaProvider.js';

const router = express.Router();

const validate = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ============================================
// Types
// ============================================

interface ChatContext {
  storyId: string;
  userId: string;
  message: string;
  mentions?: { shots?: string[]; characters?: string[] };
  temperature: number;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  action?: ChatAction;
}

interface ChatAction {
  type: 'update_shot_prompt' | 'update_shot_camera' | 'update_shot_duration' | 'update_shot_transition';
  shotId: string;
  field: string;
  before: string;
  after: string;
  status: 'proposed' | 'applied' | 'dismissed';
}

interface ConversationSummary {
  storyId: string;
  summaries: Array<{
    timestamp: string;
    summary: string;
    actions: ChatAction[];
  }>;
  updatedAt: string;
}

// ============================================
// Helper: Build Gemini Context
// ============================================

async function buildGeminiContext(storyId: string, userId: string, mentions?: ChatContext['mentions']): Promise<string> {
  // Fetch story
  const storyResult = await query(
    `SELECT s.*, s.brief->>'narrative' as narrative,
            (s.brief->>'targetDurationSeconds')::int as target_duration_seconds,
            s.brief->>'aspectRatio' as aspect_ratio,
            s.brief->>'resolution' as resolution,
            s.brief->'characterReferences' as character_references
     FROM stories s
     WHERE s.id = $1`,
    [storyId]
  );
  if (storyResult.rows.length === 0) throw new Error('Story not found');

  const story = storyResult.rows[0];

  // Fetch shots
  const shotsResult = await query(
    `SELECT s.*, fl.similarity_score, fl.threshold_used, fl.passed, fl.retry_count, fl.character_name
     FROM shots s
     LEFT JOIN face_lock_verifications fl ON fl.shot_id = s.id
     WHERE s.story_id = $1
     ORDER BY s.order_index`,
    [storyId]
  );

  // Fetch characters
  const charsResult = await query(
    `SELECT * FROM characters WHERE story_id = $1`,
    [storyId]
  );

  // Fetch generation status
  const genResult = await query(
    `SELECT status, error_message, selected_model_id, generation_started_at, generation_completed_at
     FROM shots WHERE story_id = $1`,
    [storyId]
  );

  // Fetch user feedback
  const fbResult = await query(
    `SELECT * FROM user_feedback WHERE story_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [storyId]
  );

  // Filter by mentions if provided
  let shots = shotsResult.rows;
  if (mentions?.shots?.length) {
    shots = shots.filter(s => mentions.shots!.includes(s.id));
  }
  let characters = charsResult.rows;
  if (mentions?.characters?.length) {
    characters = characters.filter(c => mentions.characters!.includes(c.name));
  }

  const context = {
    storyBrief: {
      narrative: story.narrative,
      targetDurationSeconds: story.target_duration_seconds,
      aspectRatio: story.aspect_ratio,
      resolution: story.resolution,
    },
    shots: shots.map(s => ({
      id: s.id,
      orderIndex: s.order_index,
      visualDescription: s.visual_description,
      durationSeconds: s.duration_seconds,
      cameraMotion: s.camera_motion,
      transition: s.transition,
      status: s.status,
      faceLock: {
        similarityScore: s.similarity_score,
        threshold: s.threshold_used,
        passed: s.passed,
        retryCount: s.retry_count,
        characterName: s.character_name,
      },
    })),
    characters: characters.map(c => ({
      name: c.name,
    })),
    generationStatus: genResult.rows.map(s => ({
      shotId: s.id,
      status: s.status,
      modelId: s.selected_model_id,
      error: s.error_message,
    })),
    userFeedback: fbResult.rows,
  };

  return JSON.stringify(context, null, 2);
}

// ============================================
// POST /api/stories/:id/chat - Send message, stream response
// ============================================

router.post(
  '/stories/:storyId/chat',
  [
    param('storyId').isUUID(),
    body('message').isString().notEmpty().withMessage('Message required'),
    body('temperature').optional().isFloat({ min: 0, max: 1 }),
    body('mentions').optional().isObject(),
    body('model').optional().isIn(['gemini', 'nvidia']).withMessage('Model must be gemini or nvidia'),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const { message, temperature = 0.3, mentions, model: selectedModel = 'gemini' } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify story exists and user has access
    const storyResult = await query('SELECT id, user_id FROM stories WHERE id = $1', [storyId]);
    if (storyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const isOwner = storyResult.rows[0].user_id === userId;
    const isAdmin = req.user?.role === 'admin';
    const canWrite = isOwner || isAdmin;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial event
    res.write(`event: start\n`);
    res.write(`data: ${JSON.stringify({ storyId, timestamp: new Date().toISOString() })}\n\n`);

    let isClosed = false;
    req.on('close', () => { isClosed = true; });

    try {
      // Build context
      const contextStr = await buildGeminiContext(storyId as string, userId as string, mentions);

      // Get user's temperature setting
      const settingsResult = await query(
        `SELECT settings FROM user_settings WHERE user_id = $1`,
        [userId]
      );
      const userTemp = settingsResult.rows[0]?.settings?.temperature ?? temperature;

      // System prompt
      const systemPrompt = `You are the AI Video FTE co-worker. You help users refine prompts, fix issues, and guide the video generation pipeline.

RULES:
1. Be concise and actionable.
2. When proposing changes, output structured actions in this format:
   ACTION: { "type": "update_shot_prompt|update_shot_camera|update_shot_duration|update_shot_transition", "shotId": "...", "field": "...", "before": "...", "after": "..." }
3. Only propose changes the user can confirm (shot prompts, camera, duration, transitions).
4. If user mentions @shot-X or @character-Y, focus on that context.
5. Detect conflicts with prior instructions and ask for clarification.
6. For visual reasoning, user must explicitly say "look at frames".

Current story context:
${contextStr}`;

      // Create LLM provider based on user selection
      const providerName: LLMProviderName = selectedModel;
      let provider;
      if (providerName === 'nvidia' && config.nvidiaNimApiKey) {
        provider = new NvidiaProvider(config.nvidiaNimApiKey);
      } else if (config.llmApiKey) {
        provider = new GeminiProvider(config.llmApiKey);
      } else {
        throw new Error('No LLM provider configured. Set LLM_API_KEY or NVIDIA_NIM_API_KEY.');
      }

      // Stream response through provider
      const stream = provider.streamChat(systemPrompt, message, userTemp);

      let fullResponse = '';
      let actionBuffer = '';

      for await (const chunk of stream) {
        if (isClosed) break;

        const token = chunk.token;
        if (!token) continue;

        fullResponse += token;
        actionBuffer += token;

        // Check for action in buffer
        const actionMatch = actionBuffer.match(/ACTION:\s*(\{.*?\})/);
        if (actionMatch) {
          try {
            const action = JSON.parse(actionMatch[1]);
            // Send action as separate event
            res.write(`event: action\n`);
            res.write(`data: ${JSON.stringify(action)}\n\n`);
            actionBuffer = ''; // Reset buffer after action
          } catch {
            // Invalid JSON, continue buffering
          }
        }

        // Stream token
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }

      // Extract any remaining action
      const finalActionMatch = fullResponse.match(/ACTION:\s*(\{.*?\})/);
      let action: ChatAction | null = null;
      if (finalActionMatch) {
        try {
          action = JSON.parse(finalActionMatch[1]);
        } catch {}
      }

      // Save conversation summary
      const summary = {
        timestamp: new Date().toISOString(),
        summary: fullResponse.substring(0, 500),
        actions: action ? [action] : [],
      };

      await query(
        `INSERT INTO story_conversations (story_id, summaries, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (story_id) DO UPDATE
         SET summaries = story_conversations.summaries || $2,
             updated_at = NOW()`,
        [storyId, JSON.stringify([summary])]
      );

      // Send completion
      if (!isClosed) {
        res.write(`event: complete\n`);
        res.write(`data: ${JSON.stringify({ action, summary })}\n\n`);
      }

    } catch (error) {
      console.error('Chat error:', error);
      if (!isClosed) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Chat failed' })}\n\n`);
      }
    }
  }
);

// ============================================
// GET /api/chat/providers - List available LLM providers
// ============================================

router.get('/providers', (req: Request, res: Response) => {
  const providers: { name: string; available: boolean; model: string }[] = [];
  if (config.llmApiKey) {
    providers.push({ name: 'gemini', available: true, model: 'Gemini 3.5 Flash' });
  }
  if (config.nvidiaNimApiKey) {
    providers.push({ name: 'nvidia', available: true, model: 'Nemotron 3 Ultra 550B' });
  }
  res.json({ providers });
});

// ============================================
// GET /api/stories/:id/conversation - Fetch summaries
// ============================================

router.get(
  '/stories/:storyId/conversation',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify access
    const storyResult = await query('SELECT id, user_id FROM stories WHERE id = $1', [storyId]);
    if (storyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const isOwner = storyResult.rows[0].user_id === userId;
    const isAdmin = req.user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await query(
      `SELECT summaries, updated_at FROM story_conversations WHERE story_id = $1`,
      [storyId]
    );

    if (result.rows.length === 0) {
      return res.json({
        storyId,
        summaries: [],
        updatedAt: null,
      });
    }

    res.json({
      storyId,
      summaries: result.rows[0].summaries,
      updatedAt: result.rows[0].updated_at,
    });
  }
);

// ============================================
// GET /api/stories/:id/chat/stream - SSE for real-time updates
// ============================================

router.get(
  '/stories/:storyId/chat/stream',
  [param('storyId').isUUID()],
  validate,
  async (req: Request, res: Response) => {
    const { storyId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify access
    const storyResult = await query('SELECT id, user_id FROM stories WHERE id = $1', [storyId]);
    if (storyResult.rows.length === 0) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    const isOwner = storyResult.rows[0].user_id === userId;
    const isAdmin = req.user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ storyId, timestamp: new Date().toISOString() })}\n\n`);

    const redis = getRedis();
    await redis.connect();

    const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let isClosed = false;

    const cleanup = () => { isClosed = true; };
    req.on('close', cleanup);
    req.on('end', cleanup);

    const heartbeatInterval = setInterval(() => {
      if (!isClosed) res.write(`: heartbeat\n\n`);
    }, 30000);

    try {
      let lastId = '$';
      while (!isClosed) {
        try {
          const results = await redis.xreadgroup(
            'GROUP', 'chat-streamer', `chat-${connectionId}`,
            'COUNT', 50, 'BLOCK', 5000,
            'STREAMS', `story_chat:${storyId}`, lastId
          ) as [string, [string, [string, string][]][]][];

          if (!results) continue;

          for (const [streamName, messages] of results) {
            for (const message of messages) {
              if (isClosed) break;
              const messageId = message[0];
              const fields = message[1] as [string, string][];
              lastId = messageId;

              const data = Object.fromEntries(fields);
              if (data.event) {
                try {
                  const eventData = JSON.parse(data.event);
                  res.write(`event: ${eventData.type}\n`);
                  res.write(`data: ${JSON.stringify(eventData.payload)}\n\n`);
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } catch (streamError) {
          if (!isClosed) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } finally {
      clearInterval(heartbeatInterval);
      try {
        await redis.xgroup('DESTROY', `story_chat:${storyId}`, `chat-${connectionId}`);
      } catch {}
    }
  }
);

export default router;