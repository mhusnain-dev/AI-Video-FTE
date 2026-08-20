/**
 * Unit tests for Video Merger (Phase 6.1 - Task 41)
 */

import {
  mergeStoryShots,
  generateDeliveryPackage,
  partialRegenerate,
  buildMergeFilterComplex,
  buildScaleFilter,
  getResolutionDimensions,
  buildAudioInputs,
  checkVideoHasAudio,
  getVideoDuration,
  type ShotVideoInfo,
} from '@/merger/merger';
import {
  buildTransitionFilter,
} from '@/merger/transitionSystem';
import type { TransitionConfig, AudioConfig, Resolution, AspectRatio } from '@/shared/types';

jest.mock('@/shared/db', () => ({
  query: jest.fn(),
}));

jest.mock('@/shared/events', () => ({
  emitShotStateChange: jest.fn().mockResolvedValue(undefined),
  emitStoryStateChange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/config', () => ({
  config: {
    merger: {
      ffmpegPath: 'ffmpeg',
      defaultTransition: { type: 'crossfade', durationSeconds: 0.5 },
      maxMergeTimeMs: 300000,
    },
    redis: { host: 'localhost', port: 6379, password: '', db: 0 },
    faceLock: {
      perModelCharacterThresholds: {},
      defaultPerModelThresholds: {},
      maxRetries: 3,
      perModelCharacterRetries: {},
    },
    elevenlabsApiKey: 'test-key',
  },
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
}));

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(8),
  text: async () => '',
} as Response) as unknown as typeof fetch;

import { query } from '@/shared/db';
import { spawn, execSync } from 'child_process';
import { stat, writeFile, unlink, access } from 'fs/promises';
import type { QueryResult, QueryResultRow } from 'pg';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockAccess = access as jest.MockedFunction<typeof access>;

function createQueryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    rows,
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  } as QueryResult<T>;
}

describe('Video Merger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Helper Functions
  // ============================================

  const createMockStory = (overrides = {}) => ({
    id: 'story-1',
    title: 'Test Story',
    description: 'A test story',
    resolution: '1080p' as Resolution,
    aspect_ratio: '16:9' as AspectRatio,
    audio_config: { useNativeAudio: true },
    tags: ['test'],
    created_at: new Date(),
    completed_at: new Date(),
    ...overrides,
  });

  const createMockShot = (overrides = {}) => ({
    id: `shot-${Math.random()}`,
    story_id: 'story-1',
    order: 1,
    status: 'completed',
    video_url: `/path/to/video.mp4`,
    duration_seconds: 5,
    model_id: 'veo3-low',
    ...overrides,
  });

  const mockSpawnSuccess = () => {
    // Mock for both ffmpeg and ffprobe (multiple calls)
    // Use synchronous callbacks to avoid fake timer issues
    const ffmpegProc = {
      stderr: { on: jest.fn() },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0); // Immediate callback
        // Don't call error handler
      }),
    };
    const ffprobeProc = {
      stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('1')); }) },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0); // Immediate callback
        // Don't call error handler
      }),
    };

    mockSpawn.mockReset();

    // Set up mock to return based on command
    mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
      // ffprobe commands
      if (cmd === 'ffprobe' || args?.includes('-show_entries')) {
        return ffprobeProc as any;
      }
      // ffmpeg command
      return ffmpegProc as any;
    });

    return ffmpegProc;
  };

  const mockSpawnFailure = (code = 1, stderr = 'FFmpeg error') => {
    const ffmpegProc = {
      stderr: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from(stderr)); }) },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(code); // Immediate callback
        // Don't call error handler
      }),
    };
    const ffprobeProc = {
      stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('1')); }) },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0); // Immediate callback
        // Don't call error handler
      }),
    };

    mockSpawn.mockReset();
    mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'ffprobe' || args?.includes('-show_entries')) {
        return ffprobeProc as any;
      }
      return ffmpegProc as any;
    });

    return ffmpegProc;
  };

  const setupMergeMock = (story: any, shots: any[]) => {
    mockQuery
      .mockResolvedValueOnce(createQueryResult([story])) // story query
      .mockResolvedValueOnce(createQueryResult(shots));  // shots query
    mockStat.mockResolvedValueOnce({ size: 1000000 } as any); // file stat
  };

  // ============================================
  // getResolutionDimensions Tests
  // ============================================

  describe('getResolutionDimensions', () => {
    test('returns correct dimensions for 720p', () => {
      expect(getResolutionDimensions('720p')).toEqual([1280, 720]);
    });

    test('returns correct dimensions for 1080p', () => {
      expect(getResolutionDimensions('1080p')).toEqual([1920, 1080]);
    });

    test('returns correct dimensions for 4K', () => {
      expect(getResolutionDimensions('4K')).toEqual([3840, 2160]);
    });

    test('defaults to 1080p for unknown resolution', () => {
      expect(getResolutionDimensions('unknown' as Resolution)).toEqual([1920, 1080]);
    });
  });

  // ============================================
  // buildScaleFilter Tests
  // ============================================

  describe('buildScaleFilter', () => {
    test('generates correct scale and pad filter', () => {
      const shot = { shotId: 'shot-1', videoPath: '/path/video.mp4', durationSeconds: 5, hasAudio: false };
      const filter = buildScaleFilter(0, shot, '1080p', '16:9');

      expect(filter).toContain('[0:v]');
      expect(filter).toContain('scale=1920:1080');
      expect(filter).toContain('force_original_aspect_ratio=decrease');
      expect(filter).toContain('pad=1920:1080');
      expect(filter).toContain('setsar=1');
      expect(filter).toContain('[v0]');
    });

    test('handles different aspect ratios', () => {
      const shot = { shotId: 'shot-1', videoPath: '/path/video.mp4', durationSeconds: 5, hasAudio: false };
      const filter = buildScaleFilter(0, shot, '1080p', '9:16');

      expect(filter).toContain('pad=1920:1080');
    });
  });

  // ============================================
  // buildTransitionFilter Tests
  // ============================================

  describe('buildTransitionFilter', () => {
    const transition: TransitionConfig = { type: 'crossfade', durationSeconds: 0.5 };

    test('generates crossfade filter', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: 'crossfade',
      });

      expect(filter).toContain('[v0][v1]');
      expect(filter).toContain('xfade=transition=fade');
      expect(filter).toContain('duration=0.5');
      expect(filter).toContain('offset=4.5');
      expect(filter).toContain('[v1]');
    });

    test('calculates offset correctly', () => {
      // Shot duration 5s, transition 0.5s -> offset = 4.5
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: 'crossfade',
      });
      expect(filter).toContain('offset=4.5');
    });

    test('handles slide transition', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'slide',
      });

      expect(filter).toContain('xfade=transition=slidelossless');
      expect(filter).toContain('duration=1');
    });

    test('handles zoom transition', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'zoom',
      });

      expect(filter).toContain('xfade=transition=zoom');
    });

    test('handles wipe transition', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 1.0,
        offsetSeconds: 4.0,
        type: 'wipe',
      });

      expect(filter).toContain('xfade=transition=wipeleft');
    });

    test('defaults to crossfade for unknown type', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 0.5,
        offsetSeconds: 4.5,
        type: 'unknown',
      });

      expect(filter).toContain('xfade=transition=fade');
    });

    test('handles zero offset when transition longer than shot', () => {
      const filter = buildTransitionFilter({
        inputA: 'v0',
        inputB: 'v1',
        output: 'v1',
        durationSeconds: 10,
        offsetSeconds: 0,
        type: 'crossfade',
      });

      expect(filter).toContain('offset=0');
    });
  });

  // ============================================
  // buildMergeFilterComplex Tests
  // ============================================

  describe('buildMergeFilterComplex', () => {
    const shots = [
      { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      { shotId: 'shot-2', videoPath: '/path/2.mp4', durationSeconds: 5, hasAudio: false },
      { shotId: 'shot-3', videoPath: '/path/3.mp4', durationSeconds: 5, hasAudio: false },
    ];

    test('single shot returns scale filter only', () => {
      const filter = buildMergeFilterComplex([shots[0]], { type: 'crossfade', durationSeconds: 0.5 }, '1080p', '16:9');

      expect(filter).toContain('[0:v]');
      expect(filter).toContain('[outv]');
      expect(filter).not.toContain('xfade');
    });

    test('multiple shots includes xfade transitions', () => {
      const filter = buildMergeFilterComplex(shots, { type: 'crossfade', durationSeconds: 0.5 }, '1080p', '16:9');

      expect(filter).toContain('xfade=transition=fade');
      expect(filter.split('xfade').length).toBe(3); // 2 transitions + original string
      expect(filter).toContain('[outv]');
    });

    test('correct number of scale filters for each shot', () => {
      const filter = buildMergeFilterComplex(shots, { type: 'crossfade', durationSeconds: 0.5 }, '1080p', '16:9');

      expect(filter.match(/scale=/g)?.length).toBe(3);
    });
  });

  // ============================================
  // mergeStoryShots Tests
  // ============================================

  describe('mergeStoryShots', () => {
    test('throws if story not found', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(mergeStoryShots('nonexistent')).rejects.toThrow('Story nonexistent not found');
    });

    test('throws if no completed shots', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([createMockStory()]))
        .mockResolvedValueOnce(createQueryResult([]));

      await expect(mergeStoryShots('story-1')).rejects.toThrow('No completed shots for story story-1');
    });

    test('throws if shot missing video URL', async () => {
      mockQuery
        .mockResolvedValueOnce(createQueryResult([createMockStory()]))
        .mockResolvedValueOnce(createQueryResult([createMockShot({ video_url: null })]));

      await expect(mergeStoryShots('story-1')).rejects.toThrow('missing video URL');
    });

    test('merges shots successfully', async () => {
      const story = createMockStory();
      const shots = [
        createMockShot({ id: 'shot-1', order: 1, video_url: '/path/1.mp4', duration_seconds: 5 }),
        createMockShot({ id: 'shot-2', order: 2, video_url: '/path/2.mp4', duration_seconds: 5 }),
      ];

      setupMergeMock(story, shots);
      mockSpawnSuccess();

      const result = await mergeStoryShots('story-1');

      expect(result).toBeDefined();
      expect(result.videoPath).toContain('output.mp4');
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
      expect(result.resolution).toBe('1080p');
      expect(result.format).toBe('mp4');
      expect(result.fileSizeBytes).toBe(1000000);

      // Verify FFmpeg was called (find the call with -filter_complex)
      const ffmpegCall = mockSpawn.mock.calls.find((call: any[]) => call[1]?.includes('-filter_complex'));
      expect(ffmpegCall).toBeDefined();
      const spawnArgs = ffmpegCall![1];
      expect(spawnArgs).toContain('-filter_complex');
      // filter_complex is a single string containing the filter graph
      const filterComplexIdx = spawnArgs.indexOf('-filter_complex');
      const filterComplex = spawnArgs[filterComplexIdx + 1];
      expect(filterComplex).toContain('xfade');
      expect(spawnArgs).toContain('libx264');
      expect(spawnArgs).toContain('aac');
    });

    test('uses custom transition from options', async () => {
      const story = createMockStory();
      const shots = [createMockShot(), createMockShot({ id: 'shot-2' })];

      setupMergeMock(story, shots);
      mockSpawnSuccess();

      await mergeStoryShots('story-1', { transition: { type: 'slide', durationSeconds: 1.0 } });

      const ffmpegCall = mockSpawn.mock.calls.find((call: any[]) => call[1]?.includes('-filter_complex'));
      expect(ffmpegCall).toBeDefined();
      const spawnArgs = ffmpegCall![1];
      const filterComplexIdx = spawnArgs.indexOf('-filter_complex');
      const filterComplex = spawnArgs[filterComplexIdx + 1];
      expect(filterComplex).toContain('slidelossless');
    });

    test('uses custom resolution from options', async () => {
      const story = createMockStory({ resolution: '1080p' });
      const shots = [createMockShot()];

      setupMergeMock(story, shots);
      mockSpawnSuccess();

      await mergeStoryShots('story-1', { resolution: '4K' });

      const ffmpegCall = mockSpawn.mock.calls.find((call: any[]) => call[1]?.includes('-filter_complex'));
      expect(ffmpegCall).toBeDefined();
      const spawnArgs = ffmpegCall![1];
      const filterComplexIdx = spawnArgs.indexOf('-filter_complex');
      const filterComplex = spawnArgs[filterComplexIdx + 1];
      expect(filterComplex).toContain('scale=3840:2160');
    });

    test('throws on FFmpeg failure', async () => {
      const story = createMockStory();
      const shots = [createMockShot()];

      setupMergeMock(story, shots);
      mockSpawnFailure(1, 'FFmpeg error');

      await expect(mergeStoryShots('story-1')).rejects.toThrow('FFmpeg merge failed');
    });

    test('records merge completion in database', async () => {
      const story = createMockStory();
      const shots = [createMockShot()];

      setupMergeMock(story, shots);
      mockSpawnSuccess();

      await mergeStoryShots('story-1');

      // Check update query was called
      const updateCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0].includes('UPDATE stories')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain('merged_video_path');
      expect(updateCall![0]).toContain('status = \'merging\'');
    });
  });

  // ============================================
  // generateDeliveryPackage Tests
  // ============================================

  describe('generateDeliveryPackage', () => {
    test('throws if story not found', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(generateDeliveryPackage('nonexistent')).rejects.toThrow('Story nonexistent not found');
    });

    test('builds delivery package with all components', async () => {
      const story = createMockStory({
        merged_video_path: '/path/merged.mp4',
        subtitle_config: { format: 'srt', language: 'en' },
      });
      const shots = [createMockShot({ id: 'shot-1' }), createMockShot({ id: 'shot-2' })];
      const verifications = [
        { shot_id: 'shot-1', character_name: 'John', similarity_score: 0.9, threshold_used: 0.8, passed: true, retry_count: 0, model_id: 'veo3-low' },
      ];
      const sacredGuardAudits = [
        { shot_id: 'shot-1', match_type: 'denylist', matched_entity: 'none', confidence: 0.1, enforcement_point: 'pre_dispatch' },
      ];
      const costRecords = [
        { story_id: 'story-1', shot_id: 'shot-1', cost_type: 'estimated', amount_usd: '0.04', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-2', cost_type: 'estimated', amount_usd: '0.02', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-1', cost_type: 'actual', amount_usd: '0.05', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-2', cost_type: 'actual', amount_usd: '0.03', model_id: 'veo3-low' },
      ];
      const events = [
        { event_type: 'shot_completed', entity_type: 'shot', entity_id: 'shot-1', from_state: 'generating', to_state: 'completed', timestamp: new Date(), metadata: {} },
      ];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story])) // story
        .mockResolvedValueOnce(createQueryResult(shots)) // shots
        .mockResolvedValueOnce(createQueryResult(verifications)) // verifications
        .mockResolvedValueOnce(createQueryResult(costRecords)) // costs (buildCostSummary)
        .mockResolvedValueOnce(createQueryResult(events)) // events (buildGenerationLogs)
        .mockResolvedValueOnce(createQueryResult(sacredGuardAudits)) // sacred guard for shot-1
        .mockResolvedValueOnce(createQueryResult(sacredGuardAudits)) // sacred guard for shot-2
        .mockResolvedValueOnce(createQueryResult([story])); // story for generateSubtitles

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.storyId).toBe('story-1');
      expect(pkg.videoUrl).toContain('/api/download/');
      expect(pkg.resolution).toBe('1080p');
      expect(pkg.format).toBe('mp4');
      expect(pkg.subtitles).toBeDefined();
      expect(pkg.subtitles?.format).toBe('srt');
      expect(pkg.metadata.title).toBe('Test Story');
      expect(pkg.metadata.totalShots).toBe(2);
      expect(pkg.metadata.successfulShots).toBe(2);
      expect(pkg.costSummary.totalActual).toBe(0.08);
      expect(pkg.logs.length).toBe(1);
      expect(pkg.verificationReports.length).toBe(2);
      expect(pkg.expiresAt).toBeInstanceOf(Date);
    });
  });

  // ============================================
  // Audio Handling Tests (Task 43)
  // ============================================

  describe('buildAudioInputs', () => {
    test('returns empty array when no audio config provided', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = { useNativeAudio: false };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs).toEqual([]);
    });

    test('includes TTS audio when ttsConfig provided', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'shivank', style: 'deep breath', text: 'Hello world' },
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_');
    });

    test('includes music track when musicConfig provided', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'track-1', volume: 0.5 },
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('music_');
    });

    test('includes custom audio assets when provided', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        customAudioAssets: ['/path/custom1.mp3', '/path/custom2.mp3'],
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(2);
      expect(inputs).toContain('/path/custom1.mp3');
      expect(inputs).toContain('/path/custom2.mp3');
    });

    test('combines all audio sources', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'shivank', style: 'deep breath', text: 'Hello world' },
        musicConfig: { source: 'royalty_free', trackId: 'track-1' },
        customAudioAssets: ['/path/custom.mp3'],
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(3);
    });
  });

  describe('checkVideoHasAudio', () => {
    test('returns true when video has audio stream', async () => {
      const mockProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('audio')); }) },
        on: jest.fn((event, cb) => { if (event === 'close') cb(0); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const result = await checkVideoHasAudio('/path/video.mp4');
      expect(result).toBe(true);
    });

    test('returns false when video has no audio stream', async () => {
      const mockProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('')); }) },
        on: jest.fn((event, cb) => { if (event === 'close') cb(0); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const result = await checkVideoHasAudio('/path/video.mp4');
      expect(result).toBe(false);
    });

    test('returns false on ffprobe error', async () => {
      const mockProc = {
        stdout: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === 'error') cb(new Error('not found')); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const result = await checkVideoHasAudio('/path/video.mp4');
      expect(result).toBe(false);
    });
  });

  describe('getVideoDuration', () => {
    test('returns duration from ffprobe', async () => {
      const mockProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('10.5')); }) },
        on: jest.fn((event, cb) => { if (event === 'close') cb(0); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const result = await getVideoDuration('/path/video.mp4');
      expect(result).toBe(10.5);
    });

    test('returns 0 for invalid duration', async () => {
      const mockProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('invalid')); }) },
        on: jest.fn((event, cb) => { if (event === 'close') cb(0); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const result = await getVideoDuration('/path/video.mp4');
      expect(result).toBe(0);
    });

    test('rejects on ffprobe error', async () => {
      const mockProc = {
        stdout: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === 'close') cb(1); }),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      await expect(getVideoDuration('/path/video.mp4')).rejects.toThrow('Failed to get video duration');
    });
  });

  // ============================================
  // partialRegenerate Tests
  // ============================================

  describe('partialRegenerate', () => {
    test('throws if shots not found', async () => {
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      await expect(partialRegenerate('story-1', ['shot-1'])).rejects.toThrow('Some shots not found');
    });

    test('resets shot statuses and re-merges', async () => {
      const shots = [createMockShot({ id: 'shot-1' })];

      mockQuery
        .mockResolvedValueOnce(createQueryResult(shots)) // verify shots exist
        .mockResolvedValueOnce(createQueryResult([])) // update status
        .mockResolvedValueOnce(createQueryResult([createMockStory()])) // story for merge
        .mockResolvedValueOnce(createQueryResult(shots)); // shots for merge

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      await partialRegenerate('story-1', ['shot-1']);

      // Check status reset
      const updateCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0].includes('UPDATE shots')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain("status = 'approved'");
    });
  });

  // ============================================
  // Output Formats & Subtitles Tests (Task 44)
  // ============================================

  describe('generateSubtitles', () => {
    test('generates SRT format by default', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [{ narration: 'Hello world' }, { audioCues: ['Sound effect'] }] });

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story])); // Story query for generateSubtitles

      const result = await generateSubtitles('story-1', { format: 'srt', language: 'en' });
      expect(result.format).toBe('srt');
      expect(result.content).toContain('-->');
      expect(result.language).toBe('en');
    });

    test('generates VTT format', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [{ narration: 'Hola mundo' }] });

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'vtt', language: 'es' });
      expect(result.format).toBe('vtt');
      expect(result.language).toBe('es');
    });

    test('generates ASS format', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [{ narration: 'Bonjour le monde' }] });

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'ass', language: 'fr' });
      expect(result.format).toBe('ass');
      expect(result.language).toBe('fr');
    });

    test('handles missing format gracefully', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [] });

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', {});
      expect(result.format).toBe('srt');
      expect(result.language).toBe('en');
    });
  });

  describe('Output format resolution handling', () => {
    test('mergeStoryShots accepts 720p resolution', async () => {
      const story = createMockStory({ resolution: '720p' });
      const shots = [createMockShot()];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots));

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      const result = await mergeStoryShots('story-1', { resolution: '720p' });

      expect(result.resolution).toBe('720p');
    });

    test('mergeStoryShots accepts 4K resolution', async () => {
      const story = createMockStory({ resolution: '1080p' });
      const shots = [createMockShot()];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots));

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      const result = await mergeStoryShots('story-1', { resolution: '4K' });

      expect(result.resolution).toBe('4K');
    });

    test('uses story resolution when no override provided', async () => {
      const story = createMockStory({ resolution: '720p' });
      const shots = [createMockShot()];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots));

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      const result = await mergeStoryShots('story-1');

      expect(result.resolution).toBe('720p');
    });
  });

  // ============================================
  // Delivery Package Tests (Task 45)
  // ============================================

  describe('generateDeliveryPackage - comprehensive', () => {
    test('includes video URL with 7-day TTL', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];
      const verifications: any[] = [];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story])) // story
        .mockResolvedValueOnce(createQueryResult(shots)) // shots
        .mockResolvedValueOnce(createQueryResult(verifications)) // face_lock_verifications
        .mockResolvedValueOnce(createQueryResult([])) // cost_records
        .mockResolvedValueOnce(createQueryResult([])) // story_events (logs)
        .mockResolvedValueOnce(createQueryResult([])); // sacred_guard_audits for shot-1

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.videoUrl).toContain('/api/download/');
      expect(pkg.videoUrl).toContain('token=');
      expect(pkg.videoUrl).toContain('expires=');
      expect(pkg.expiresAt).toBeInstanceOf(Date);
      // Check TTL is approximately 7 days
      const ttlMs = pkg.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000); // > 6 days
      expect(ttlMs).toBeLessThan(8 * 24 * 60 * 60 * 1000); // < 8 days
    });

    test('includes cost summary with estimated and actual costs', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' }), createMockShot({ id: 'shot-2' })];
      const costRecords = [
        { story_id: 'story-1', shot_id: 'shot-1', cost_type: 'estimated', amount_usd: '0.10', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-2', cost_type: 'estimated', amount_usd: '0.05', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-1', cost_type: 'actual', amount_usd: '0.12', model_id: 'veo3-low' },
        { story_id: 'story-1', shot_id: 'shot-2', cost_type: 'actual', amount_usd: '0.04', model_id: 'veo3-low' },
      ];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([])) // verifications
        .mockResolvedValueOnce(createQueryResult(costRecords))
        .mockResolvedValueOnce(createQueryResult([])) // events
        .mockResolvedValueOnce(createQueryResult([])) // sacred guard shot-1
        .mockResolvedValueOnce(createQueryResult([])); // sacred guard shot-2

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.costSummary.totalEstimated).toBeCloseTo(0.15);
      expect(pkg.costSummary.totalActual).toBeCloseTo(0.16);
      expect(pkg.costSummary.driftPercentage).toBeCloseTo(6.67, 1);
      expect(pkg.costSummary.currency).toBe('USD');
    });

    test('includes generation logs', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];
      const events = [
        { event_type: 'shot_started', entity_type: 'shot', entity_id: 'shot-1', from_state: 'approved', to_state: 'generating', timestamp: new Date('2024-01-01T10:00:00Z'), metadata: {} },
        { event_type: 'shot_completed', entity_type: 'shot', entity_id: 'shot-1', from_state: 'generating', to_state: 'completed', timestamp: new Date('2024-01-01T10:05:00Z'), metadata: {} },
      ];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([])) // verifications
        .mockResolvedValueOnce(createQueryResult([])) // costs
        .mockResolvedValueOnce(createQueryResult(events)) // logs
        .mockResolvedValueOnce(createQueryResult([])); // sacred guard

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.logs.length).toBe(2);
      expect(pkg.logs[0].stage).toBe('shot_started');
      expect(pkg.logs[1].stage).toBe('shot_completed');
      expect(pkg.logs[0].level).toBe('info');
    });

    test('includes verification reports per shot', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' }), createMockShot({ id: 'shot-2' })];
      const verifications = [
        { shot_id: 'shot-1', character_name: 'Alice', similarity_score: 0.92, threshold_used: 0.85, passed: true, retry_count: 0, model_id: 'veo3-low' },
        { shot_id: 'shot-1', character_name: 'Bob', similarity_score: 0.88, threshold_used: 0.85, passed: true, retry_count: 1, model_id: 'veo3-low' },
      ];
      const sacredGuardAuditsShot1 = [
        { shot_id: 'shot-1', match_type: 'denylist', matched_entity: 'none', confidence: 0.05, enforcement_point: 'pre_dispatch' },
      ];
      const sacredGuardAuditsShot2: any[] = [];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story])) // story
        .mockResolvedValueOnce(createQueryResult(shots)) // shots
        .mockResolvedValueOnce(createQueryResult(verifications)) // face_lock_verifications
        .mockResolvedValueOnce(createQueryResult([])) // cost_records
        .mockResolvedValueOnce(createQueryResult([])) // story_events (logs)
        .mockResolvedValueOnce(createQueryResult(sacredGuardAuditsShot1)) // sacred_guard_audits for shot-1
        .mockResolvedValueOnce(createQueryResult(sacredGuardAuditsShot2)); // sacred_guard_audits for shot-2

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.verificationReports.length).toBe(2);
      expect(pkg.verificationReports[0].shotId).toBe('shot-1');
      expect(pkg.verificationReports[0].faceLockResults.length).toBe(2);
      expect(pkg.verificationReports[0].faceLockResults[0].characterName).toBe('Alice');
      expect(pkg.verificationReports[0].faceLockResults[0].passed).toBe(true);
      expect(pkg.verificationReports[0].sacredGuardPostAudit.length).toBe(1);
      expect(pkg.verificationReports[1].shotId).toBe('shot-2');
      expect(pkg.verificationReports[1].faceLockResults.length).toBe(0);
    });

    test('handles story without subtitle config', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([])); // sacred guard

      const pkg = await generateDeliveryPackage('story-1');

      expect(pkg.subtitles).toBeUndefined();
    });
  });

  // ============================================
  // TTS Audio Generation Tests (L269-341)
  // ============================================

  describe('generateTTSAudio - no API key fallback', () => {
    test('generates placeholder when ElevenLabs API key is missing', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = '';

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');
      expect(mockExecSync).toHaveBeenCalled();

      (config as any).elevenlabsApiKey = original;
    });

    test('generates placeholder when fetch throws non-Error', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = 'test-key';

      const origFetch = globalThis.fetch;
      const mockFn = jest.fn().mockImplementation(async () => {
        throw 'string error';
      });
      (globalThis as any).fetch = mockFn;

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');
      expect(mockFn).toHaveBeenCalled();

      (globalThis as any).fetch = origFetch;
      (config as any).elevenlabsApiKey = original;
    });

    test('generates placeholder when fetch throws an Error object', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = 'test-key';

      const origFetch = globalThis.fetch;
      const mockFn = jest.fn().mockImplementation(async () => {
        throw new Error('network timeout');
      });
      (globalThis as any).fetch = mockFn;

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');

      (globalThis as any).fetch = origFetch;
      (config as any).elevenlabsApiKey = original;
    });

    test('generates placeholder when ElevenLabs returns non-OK status', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = 'test-key';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');

      (config as any).elevenlabsApiKey = original;
    });

    test('generates placeholder when response.text() throws on non-OK status', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = 'test-key';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => { throw new Error('body consumed'); },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');

      (config as any).elevenlabsApiKey = original;
    });

    test('placeholder falls back to silent MP3 when execSync throws', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = '';

      mockExecSync.mockImplementation(() => { throw new Error('ffmpeg not found'); });

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hello world' },
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('tts_placeholder_');
      expect(mockWriteFile).toHaveBeenCalled();

      (config as any).elevenlabsApiKey = original;
    });

    test('placeholder uses default voice ID when voiceId not specified', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = 'test-key';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
        text: async () => '',
      } as Response);

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: '', style: 'normal', text: 'Hello world' },
      };

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[0]).toContain('21m00Tcm4TlvDq8ikWAM');

      (config as any).elevenlabsApiKey = original;
    });

    test('placeholder narration duration is at least 3 seconds', async () => {
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = '';

      mockExecSync.mockReturnValue(Buffer.from(''));

      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Hi' },
      };

      await buildAudioInputs(shots, audioConfig, '/tmp/test');

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('duration=3');

      (config as any).elevenlabsApiKey = original;
    });
  });

  // ============================================
  // Music Track Generation Tests (L364-386)
  // ============================================

  describe('getMusicTrack - mood-based generation', () => {
    test('generates dramatic mood track', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'dramatic', volume: 0.5 },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('music_');

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('sine=frequency=80');
      expect(execCall).toContain('tremolo=f=0.3');
    });

    test('generates upbeat mood track', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'upbeat', volume: 0.5 },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('sine=frequency=440');
      expect(execCall).toContain('chorus=');
    });

    test('generates cinematic mood track', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'cinematic', volume: 0.5 },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('aevalsrc=');
      expect(execCall).toContain('110*t');
    });

    test('generates calm mood track (default)', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'calm', volume: 0.5 },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('174.6*t');
      expect(execCall).toContain('tremolo=f=0.1');
    });

    test('falls back to silent MP3 when execSync throws', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', trackId: 'calm', volume: 0.5 },
      };

      mockExecSync.mockImplementation(() => { throw new Error('ffmpeg not found'); });

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);
      expect(inputs[0]).toContain('music_');
      expect(mockWriteFile).toHaveBeenCalled();
    });

    test('generates music with default mood when trackId not provided', async () => {
      const shots: ShotVideoInfo[] = [
        { shotId: 'shot-1', videoPath: '/path/1.mp4', durationSeconds: 5, hasAudio: false },
      ];
      const audioConfig: AudioConfig = {
        useNativeAudio: false,
        musicConfig: { source: 'royalty_free', volume: 0.5 },
      };

      mockExecSync.mockReturnValue(Buffer.from(''));

      const inputs = await buildAudioInputs(shots, audioConfig, '/tmp/test');
      expect(inputs.length).toBe(1);

      const execCall = mockExecSync.mock.calls[0][0] as string;
      expect(execCall).toContain('174.6*t');
    });
  });

  // ============================================
  // Execute Merge Error Handling Tests (L408, L463)
  // ============================================

  describe('executeMerge - error paths', () => {
    test('spawns FFmpeg with audio input arguments', async () => {
      const story = createMockStory();
      const shots = [createMockShot({ id: 'shot-1' })];

      setupMergeMock(story, shots);

      const ffmpegProc = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        }),
      };
      const ffprobeProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('1')); }) },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        }),
      };

      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'ffprobe' || args?.includes('-show_entries')) {
          return ffprobeProc as any;
        }
        return ffmpegProc as any;
      });

      // Also provide audio inputs by mocking buildAudioInputs indirectly
      // via the mergeStoryShots flow with TTS config
      const { config } = await import('@/shared/config');
      const original = (config as any).elevenlabsApiKey;
      (config as any).elevenlabsApiKey = '';
      mockExecSync.mockReturnValue(Buffer.from(''));

      await mergeStoryShots('story-1', {
        audioConfig: {
          useNativeAudio: false,
          ttsConfig: { provider: 'elevenlabs', voiceId: 'test', style: 'normal', text: 'Test narration' },
        },
      });

      const ffmpegCall = mockSpawn.mock.calls.find((call: any[]) => call[1]?.includes('-filter_complex'));
      expect(ffmpegCall).toBeDefined();
      const spawnArgs = ffmpegCall![1];
      // Should have -i flags for both video and audio inputs
      const inputCount = spawnArgs.filter((a: string) => a === '-i').length;
      expect(inputCount).toBeGreaterThanOrEqual(2); // at least video + audio

      (config as any).elevenlabsApiKey = original;
    });

    test('rejects on FFmpeg spawn error', async () => {
      const story = createMockStory();
      const shots = [createMockShot({ id: 'shot-1' })];

      setupMergeMock(story, shots);

      const ffmpegProc = {
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'error') cb(new Error('spawn EACCES'));
        }),
      };
      const ffprobeProc = {
        stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('1')); }) },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        }),
      };

      mockSpawn.mockReset();
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'ffprobe' || args?.includes('-show_entries')) {
          return ffprobeProc as any;
        }
        return ffmpegProc as any;
      });

      await expect(mergeStoryShots('story-1')).rejects.toThrow('FFmpeg spawn error');
    });
  });

  // ============================================
  // Subtitle Format Edge Cases (L789, L827, L866)
  // ============================================

  describe('generateSubtitles - edge cases', () => {
    test('defaults to SRT for unknown format', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [] });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'unknown' as any, language: 'en' });
      expect(result.format).toBe('unknown');
      expect(result.content).toContain('-->');
    });

    test('generates VTT with empty shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [] });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'vtt', language: 'en', shots: [] });
      expect(result.format).toBe('vtt');
      expect(result.content).toContain('WEBVTT');
      expect(result.content).toContain('[Generated subtitle content]');
    });

    test('generates ASS with empty shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({ shots: [] });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'ass', language: 'fr', shots: [] });
      expect(result.format).toBe('ass');
      expect(result.content).toContain('[Script Info]');
      expect(result.content).toContain('Dialogue:');
      expect(result.content).toContain('{Generated subtitle content}');
    });

    test('generates SRT with explicit shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const shots = [
        { shotId: 'shot-1', text: 'Hello', startTime: 0, endTime: 5 },
        { shotId: 'shot-2', text: 'World', startTime: 5, endTime: 10 },
      ];

      const result = await generateSubtitles('story-1', { format: 'srt', shots });
      expect(result.content).toContain('1\n00:00:00,000 --> 00:00:05,000\nHello');
      expect(result.content).toContain('2\n00:00:05,000 --> 00:00:10,000\nWorld');
    });

    test('generates VTT with explicit shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const shots = [
        { shotId: 'shot-1', text: 'Hello', startTime: 0, endTime: 5 },
      ];

      const result = await generateSubtitles('story-1', { format: 'vtt', shots });
      expect(result.content).toContain('WEBVTT');
      expect(result.content).toContain('00:00:00.000 --> 00:00:05.000');
      expect(result.content).toContain('Hello');
    });

    test('generates ASS with explicit shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const shots = [
        { shotId: 'shot-1', text: 'Hello, World', startTime: 0, endTime: 5 },
      ];

      const result = await generateSubtitles('story-1', { format: 'ass', language: 'en', shots });
      expect(result.content).toContain('Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hello\\, World');
    });

    test('generates SRT with shots from story when no explicit shots', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { id: 's1', narration: 'First shot narration', startTime: 0, endTime: 5 },
          { id: 's2', narration: 'Second shot narration', startTime: 5, endTime: 10 },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('First shot narration');
      expect(result.content).toContain('Second shot narration');
    });

    test('generates SRT with audioCues fallback', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { id: 's1', audioCues: ['Sound effect 1', 'Sound effect 2'] },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('Sound effect 1 Sound effect 2');
    });

    test('generates SRT with default timing when startTime/endTime missing', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { id: 's1', narration: 'No timing' },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('00:00:00,000 --> 00:00:05,000');
      expect(result.content).toContain('No timing');
    });
  });

  // ============================================
  // Partial Regeneration Tests (Task 46)
  // ============================================

  describe('partialRegenerate - comprehensive', () => {
    test('verifies all requested shots belong to story', async () => {
      const story = createMockStory();
      const shot1 = createMockShot({ id: 'shot-1' });
      const shot2 = createMockShot({ id: 'shot-2', story_id: 'other-story' });

      mockQuery.mockResolvedValueOnce(createQueryResult([shot1])); // Only shot-1 found

      await expect(partialRegenerate('story-1', ['shot-1', 'shot-2'])).rejects.toThrow('Some shots not found');
    });

    test('resets status to approved for re-generation', async () => {
      const shots = [createMockShot({ id: 'shot-1', status: 'completed' }), createMockShot({ id: 'shot-2', status: 'failed' })];

      mockQuery
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([])) // update
        .mockResolvedValueOnce(createQueryResult([createMockStory()]))
        .mockResolvedValueOnce(createQueryResult(shots));

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      await partialRegenerate('story-1', ['shot-1', 'shot-2']);

      const updateCall = mockQuery.mock.calls.find((call: any[]) =>
        call[0].includes('UPDATE shots')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain("status = 'approved'");
      expect(updateCall![0]).toContain("error_message = NULL");
    });

    test('passes merge options through to re-merge', async () => {
      const shots = [createMockShot({ id: 'shot-1' }), createMockShot({ id: 'shot-2' })];

      mockQuery
        .mockResolvedValueOnce(createQueryResult(shots)) // get shots for status reset
        .mockResolvedValueOnce(createQueryResult([])) // update shots
        .mockResolvedValueOnce(createQueryResult([createMockStory({ resolution: '1080p' })])) // mergeStoryShots gets story
        .mockResolvedValueOnce(createQueryResult(shots)); // mergeStoryShots gets shots

      mockStat.mockResolvedValueOnce({ size: 1000000 } as any);
      mockSpawnSuccess();

      await partialRegenerate('story-1', ['shot-1', 'shot-2'], { resolution: '4K', transition: { type: 'slide', durationSeconds: 1.0 } });

      const ffmpegCall = mockSpawn.mock.calls.find((call: any[]) => call[1]?.includes('-filter_complex'));
      expect(ffmpegCall).toBeDefined();
      const spawnArgs = ffmpegCall![1];
      const filterComplexIdx = spawnArgs.indexOf('-filter_complex');
      const filterComplex = spawnArgs[filterComplexIdx + 1];
      expect(filterComplex).toContain('slidelossless');
      expect(filterComplex).toContain('scale=3840:2160');
    });
  });

  // ============================================
  // Remaining Branch Coverage Tests
  // ============================================

  describe('remaining branch coverage', () => {
    test('L136: falls back to default audioConfig when story has no audio_config', async () => {
      const story = createMockStory({ audio_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];

      setupMergeMock(story, shots);
      mockSpawnSuccess();

      const result = await mergeStoryShots('story-1');
      expect(result).toBeDefined();
    });

    test('L590-592: delivery handles null tags and completed_at', async () => {
      const story = createMockStory({
        merged_video_path: '/path/merged.mp4',
        subtitle_config: null,
        tags: null,
        completed_at: null,
      });
      const shots = [createMockShot({ id: 'shot-1' })];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]));

      const pkg = await generateDeliveryPackage('story-1');
      expect(pkg.metadata.tags).toEqual([]);
      expect(pkg.metadata.completedAt).toBeInstanceOf(Date);
    });

    test('L684: logs include shotId for shot events', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];
      const events = [
        { event_type: 'shot_completed', entity_type: 'shot', entity_id: 'shot-1', from_state: 'generating', to_state: 'completed', timestamp: new Date(), metadata: {} },
        { event_type: 'story_started', entity_type: 'story', entity_id: 'story-1', from_state: 'pending', to_state: 'generating', timestamp: new Date(), metadata: {} },
      ];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult(events))
        .mockResolvedValueOnce(createQueryResult([]));

      const pkg = await generateDeliveryPackage('story-1');
      expect(pkg.logs[0].shotId).toBe('shot-1');
      expect(pkg.logs[1].shotId).toBeUndefined();
    });

    test('L686: logs error level when metadata has error', async () => {
      const story = createMockStory({ merged_video_path: '/path/merged.mp4', subtitle_config: null });
      const shots = [createMockShot({ id: 'shot-1' })];
      const events = [
        { event_type: 'shot_failed', entity_type: 'shot', entity_id: 'shot-1', from_state: 'generating', to_state: 'failed', timestamp: new Date(), metadata: { error: 'Generation failed' } },
      ];

      mockQuery
        .mockResolvedValueOnce(createQueryResult([story]))
        .mockResolvedValueOnce(createQueryResult(shots))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult([]))
        .mockResolvedValueOnce(createQueryResult(events))
        .mockResolvedValueOnce(createQueryResult([]));

      const pkg = await generateDeliveryPackage('story-1');
      expect(pkg.logs[0].level).toBe('error');
    });

    test('L768: subtitle uses audioCues when narration missing', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { id: 's1', audioCues: ['Sound A'] },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('Sound A');
    });

    test('L768: subtitle uses [No narration] when both narration and audioCues are empty strings', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { id: 's1', narration: '', audioCues: [''] },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('[No narration]');
    });

    test('L768: subtitle uses fallback shot ID when id missing', async () => {
      const { generateSubtitles } = await import('@/merger/merger');
      const story = createMockStory({
        shots: [
          { narration: 'No id shot' },
        ],
      });
      mockQuery.mockResolvedValueOnce(createQueryResult([story]));

      const result = await generateSubtitles('story-1', { format: 'srt' });
      expect(result.content).toContain('No id shot');
    });
  });
});