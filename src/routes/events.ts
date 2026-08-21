/**
 * SSE Events Routes
 * Real-time story event streaming via Server-Sent Events
 * GET /api/stories/:id/stream
 */

import type { Request, Response } from 'express';
import { getRedis, STREAMS } from '../shared/redis.js';
import { query } from '../shared/db.js';

interface SSEEvent {
  type: string;
  storyId?: string;
  shotId?: string;
  payload: Record<string, any>;
  traceId?: string;
  timestamp: string;
}

/**
 * SSE endpoint for real-time story updates
 * Streams events from Redis story_events stream filtered by storyId
 */
export async function handleStoryStream(req: Request, res: Response): Promise<void> {
  const { id: storyId } = req.params;

  if (!storyId) {
    res.status(400).json({ error: 'Story ID required' });
    return;
  }

  // Verify story exists
  const storyResult = await query(`SELECT id FROM stories WHERE id = $1`, [storyId]);
  if (storyResult.rows.length === 0) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ storyId, timestamp: new Date().toISOString() })}\n\n`);

  const redis = getRedis();
  await redis.connect();

  // Track active connections for cleanup
  const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[SSE] Client connected: ${connectionId} for story ${storyId}`);

  let isClosed = false;

  // Cleanup function
  const cleanup = () => {
    isClosed = true;
    console.log(`[SSE] Client disconnected: ${connectionId} for story ${storyId}`);
  };

  req.on('close', cleanup);
  req.on('end', cleanup);

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    if (!isClosed) {
      res.write(`: heartbeat\n\n`);
    }
  }, 30000);

  try {
    // Start reading from the stream
    // We'll read new events after connection time
    let lastId = '$'; // Only new messages

    while (!isClosed) {
      try {
        const results = await redis.xreadgroup(
          'GROUP',
          'dashboard-updater', // Use existing consumer group for SSE
          `sse-${connectionId}`,
          'COUNT',
          50,
          'BLOCK',
          5000,
          'STREAMS',
          STREAMS.STORY_EVENTS,
          lastId
        ) as [string, [string, [string, string][]][]][];

        if (!results) continue;

        for (const [streamName, messages] of results) {
          for (const message of messages) {
            if (isClosed) break;

            const messageId = message[0];
            const fields = message[1];

            lastId = messageId;

            // Parse event data
            const data = Object.fromEntries(fields);
            const eventDataStr = data.event;

            if (!eventDataStr) continue;

            try {
              const eventData = JSON.parse(eventDataStr) as SSEEvent;

              // Filter by storyId
              if (eventData.storyId && eventData.storyId !== storyId) {
                continue;
              }

              // Send event to client
              res.write(`event: ${eventData.type}\n`);
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            } catch (parseError) {
              console.warn(`[SSE] Failed to parse event: ${eventDataStr}`);
            }
          }
        }
      } catch (streamError) {
        if (!isClosed) {
          console.error(`[SSE] Stream read error:`, streamError);
          // Brief pause before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  } finally {
    clearInterval(heartbeatInterval);

    // Try to acknowledge any pending messages for this consumer
    try {
      await redis.xgroup('DESTROY', STREAMS.STORY_EVENTS, `sse-${connectionId}`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Health check for SSE endpoint
 */
export async function handleSSEHealth(req: Request, res: Response): Promise<void> {
  res.json({ status: 'ok', endpoint: 'events' });
}

export default {
  handleStoryStream,
  handleSSEHealth,
};