import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StateChangeEvent, Shot } from '../types/api';
import { storyKeys, shotKeys } from './useStories';

interface UseStoryStreamOptions {
  storyId: string;
  enabled?: boolean;
  onEvent?: (event: StateChangeEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

interface UseStoryStreamReturn {
  isConnected: boolean;
  lastEvent: StateChangeEvent | null;
  error: Event | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useStoryStream({
  storyId,
  enabled = true,
  onEvent,
  onError,
  onOpen,
}: UseStoryStreamOptions): UseStoryStreamReturn {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<StateChangeEvent | null>(null);
  const [error, setError] = useState<Event | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  // Update query cache based on event
  const updateCache = useCallback((event: StateChangeEvent) => {
    // Update story detail cache
    queryClient.setQueryData(storyKeys.detail(storyId), (old: any) => {
      if (!old?.data) return old;

      const newData = { ...old.data };

      // Handle story status changes
      if (event.type === 'story_status' && event.payload.status) {
        newData.status = event.payload.status;
        newData.updatedAt = event.timestamp;
      }

      // Handle shot updates
      if (event.shotId && newData.shotPlan) {
        const shotIndex = newData.shotPlan.findIndex((s: Shot) => s.id === event.shotId);
        if (shotIndex >= 0) {
          const updatedShot = { ...newData.shotPlan[shotIndex] };

          switch (event.type) {
            case 'shot_status':
              if (event.payload.status) {
                updatedShot.status = event.payload.status;
              }
              if (event.payload.progress !== undefined) {
                updatedShot.generationProgress = event.payload.progress;
              }
              break;
            case 'admission_result':
              updatedShot.admissionResult = event.payload;
              break;
            case 'generation_progress':
              updatedShot.generationProgress = event.payload.progress;
              if (event.payload.estimatedTimeRemaining) {
                updatedShot.estimatedTimeRemaining = event.payload.estimatedTimeRemaining;
              }
              break;
            case 'face_lock_result':
              if (!updatedShot.faceLockResults) updatedShot.faceLockResults = [];
              const existingIndex = updatedShot.faceLockResults.findIndex(
                (f: any) => f.characterName === event.payload.characterName
              );
              if (existingIndex >= 0) {
                updatedShot.faceLockResults[existingIndex] = event.payload;
              } else {
                updatedShot.faceLockResults.push(event.payload);
              }
              break;
            case 'merge_progress':
              updatedShot.mergeProgress = event.payload.progress;
              break;
          }

          updatedShot.updatedAt = event.timestamp;
          newData.shotPlan = [...newData.shotPlan];
          newData.shotPlan[shotIndex] = updatedShot;
        }
      }

      // Handle cost updates
      if (event.type === 'cost_update') {
        newData.costActualUsd = event.payload.actualUsd;
        newData.costDriftPercentage = event.payload.driftPercentage;
      }

      return { ...old, data: newData };
    });

    // Invalidate related queries for fresh data
    if (['shot_status', 'admission_result', 'face_lock_result', 'generation_progress', 'merge_progress'].includes(event.type)) {
      queryClient.invalidateQueries({ queryKey: shotKeys.admissionStatus(event.shotId || '') });
      queryClient.invalidateQueries({ queryKey: shotKeys.generationStatus(event.shotId || '') });
      queryClient.invalidateQueries({ queryKey: shotKeys.faceLockResults(event.shotId || '') });
    }

    if (event.type === 'delivery_ready') {
      queryClient.invalidateQueries({ queryKey: ['delivery', 'detail', storyId] });
    }
  }, [queryClient, storyId]);

  const connect = useCallback(() => {
    if (!enabled || !storyId) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const es = new EventSource(`/api/stories/${storyId}/stream`);

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        retryCountRef.current = 0;
        if (onOpen) onOpen();
      };

      es.onmessage = (messageEvent) => {
        try {
          const event = JSON.parse(messageEvent.data) as StateChangeEvent;
          setLastEvent(event);
          updateCache(event);
          if (onEvent) onEvent(event);
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      };

      es.addEventListener('story_status', (e) => {
        const event = { type: 'story_status', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('shot_status', (e) => {
        const event = { type: 'shot_status', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('admission_result', (e) => {
        const event = { type: 'admission_result', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('generation_progress', (e) => {
        const event = { type: 'generation_progress', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('face_lock_result', (e) => {
        const event = { type: 'face_lock_result', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('merge_progress', (e) => {
        const event = { type: 'merge_progress', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('delivery_ready', (e) => {
        const event = { type: 'delivery_ready', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        updateCache(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('error', (e: MessageEvent) => {
        const event = { type: 'error', ...(e.data ? JSON.parse(e.data) : {}) } as StateChangeEvent;
        setLastEvent(event);
        if (onEvent) onEvent(event);
      });

      es.addEventListener('alert', (e) => {
        const event = { type: 'alert', ...JSON.parse(e.data) } as StateChangeEvent;
        setLastEvent(event);
        if (onEvent) onEvent(event);
      });

      es.onerror = (err) => {
        setIsConnected(false);
        setError(err);
        if (onError) onError(err);

        // Auto-reconnect with exponential backoff
        es.close();

        if (enabled) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      eventSourceRef.current = es;
    } catch (e) {
      console.error('Failed to create EventSource:', e);
      setError(e as unknown as Event);
    }
  }, [enabled, storyId, onEvent, onError, onOpen, updateCache]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    disconnect();
    connect();
  }, [connect, disconnect]);

  useEffect(() => {
    if (enabled && storyId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, storyId, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    error,
    reconnect,
    disconnect,
  };
}

// ============================================
// Polling Fallback Hook
// ============================================
interface UsePollingOptions {
  storyId: string;
  enabled?: boolean;
  interval?: number;
  queryKeys?: string[][];
}

export function usePollingFallback({
  storyId,
  enabled = true,
  interval = 5000,
  queryKeys: keysToInvalidate = [],
}: UsePollingOptions) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !storyId) return;

    const poll = async () => {
      // Invalidate story detail to trigger refetch
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });

      // Invalidate additional keys
      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    const intervalId = setInterval(poll, interval);
    return () => clearInterval(intervalId);
  }, [enabled, storyId, interval, queryClient, keysToInvalidate]);
}