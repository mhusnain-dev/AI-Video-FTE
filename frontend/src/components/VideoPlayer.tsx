import { useState, useRef, useEffect } from 'react';
import {
  PlayIcon,
  PauseIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowDownTrayIcon,
  ArrowsPointingOutIcon,
  DocumentTextIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import type { SubtitleInfo } from '../types/api';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  subtitles?: SubtitleInfo;
  subtitlesEnabled?: boolean;
  selectedSubtitle?: string;
  onSubtitleChange?: (lang: string) => void;
  onSubtitlesToggle?: (enabled: boolean) => void;
}

export function VideoPlayer({
  src,
  poster,
  subtitles,
  subtitlesEnabled = true,
  selectedSubtitle = 'en',
  onSubtitleChange,
  onSubtitlesToggle,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (!isFullscreen) {
        videoRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
      setIsFullscreen(!isFullscreen);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!videoRef.current) return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.1));
        break;
      case 'm':
        toggleMute();
        break;
      case 'f':
        toggleFullscreen();
        break;
    }
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (videoRef.current && subtitles && subtitlesEnabled && subtitles.vttUrl) {
      const video = videoRef.current;

      // Remove existing track elements
      const existingTracks = video.querySelectorAll('track');
      existingTracks.forEach(track => track.remove());

      // Add new VTT track element
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = selectedSubtitle;
      track.srclang = selectedSubtitle;
      track.src = subtitles.vttUrl;
      track.default = true;
      video.appendChild(track);
    }
  }, [subtitles, subtitlesEnabled, selectedSubtitle]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="relative bg-black aspect-video"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onMouseMove={showControlsTemporarily}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        playsInline
        crossOrigin="anonymous"
      />

      {/* Loading/Error State */}
      {isPlaying ? null : (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <button
            onClick={togglePlay}
            className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors"
            aria-label="Play"
          >
            <PlayIcon className="w-8 h-8 text-gray-900 ml-1" />
          </button>
        </div>
      )}

      {/* Controls Overlay */}
      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300',
          showControls || isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Progress Bar */}
        <div className="mb-3">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            aria-label="Seek"
          />
          <div className="flex justify-between text-xs text-white/70 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-2 text-white hover:text-primary-300 transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
            </button>

            <button
              onClick={toggleMute}
              className="p-2 text-white hover:text-primary-300 transition-colors"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? <SpeakerXMarkIcon className="w-6 h-6" /> : <SpeakerWaveIcon className="w-6 h-6" />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-20 h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              aria-label="Volume"
            />

            {subtitles && (
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => onSubtitlesToggle?.(!subtitlesEnabled)}
                  className={clsx('p-2 text-white transition-colors', subtitlesEnabled ? 'text-primary-300' : 'text-white/50')}
                  aria-label={subtitlesEnabled ? 'Hide subtitles' : 'Show subtitles'}
                >
                  <DocumentTextIcon className="w-5 h-5" />
                </button>
                {subtitlesEnabled && subtitles.languages.length > 0 && (
                  <select
                    value={selectedSubtitle}
                    onChange={(e) => onSubtitleChange?.(e.target.value)}
                    className="text-sm bg-white/10 border border-white/20 rounded px-2 py-1 text-white"
                  >
                    {subtitles.languages.map(lang => (
                      <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              className="text-sm bg-white/10 border border-white/20 rounded px-2 py-1 text-white"
              aria-label="Playback speed"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                <option key={rate} value={rate}>{rate}x</option>
              ))}
            </select>

            <button
              onClick={toggleFullscreen}
              className="p-2 text-white hover:text-primary-300 transition-colors"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <XMarkIcon className="w-6 h-6" /> : <ArrowsPointingOutIcon className="w-6 h-6" />}
            </button>

            <a
              href={src}
              download="video.mp4"
              className="p-2 text-white hover:text-primary-300 transition-colors"
              aria-label="Download"
            >
              <ArrowDownTrayIcon className="w-6 h-6" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;