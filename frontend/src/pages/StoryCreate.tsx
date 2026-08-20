import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useCreateStory, useCharacters, characterKeys } from '../hooks/useStories';
import { useNotifications } from '../store/uiStore';
import { CharacterUploader } from '../components/CharacterUploader';
import { Modal } from '../components/Modal';
import type { StoryBrief, CharacterReference } from '../types/api';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5'] as const;
const RESOLUTIONS = ['720p', '1080p', '4K'] as const;
const MUSIC_SOURCES = ['royalty_free', 'elevenlabs', 'custom'] as const;

const STORAGE_KEY = 'storyCreate_draft';

interface DraftData {
  step: number;
  brief: StoryBrief;
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveDraft(data: DraftData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}

export function StoryCreate() {
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const createStory = useCreateStory();
  const queryClient = useQueryClient();

  // Load draft from localStorage
  const draft = loadDraft();
  const [step, setStep] = useState(draft?.step || 1);
  const [brief, setBrief] = useState<StoryBrief>(draft?.brief || {
    narrative: '',
    targetDurationSeconds: 30,
    aspectRatio: '16:9',
    resolution: '1080p',
    characterReferences: [],
    styleReferences: [],
    negativePrompts: [],
    audioConfig: {
      ttsVoice: 'shivank',
      ttsStyle: 'narration',
      musicSource: 'royalty_free',
      musicVolume: 0.3,
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [isSubmitting] = useState(false);
  const [storyId, setStoryId] = useState<string | null>(null);
  const [isCreatingStory, setIsCreatingStory] = useState(false);
  const [characterUploadSuccess, setCharacterUploadSuccess] = useState(false);

  // Fetch characters from backend once storyId is available
  const { data: charactersData } = useCharacters(storyId || '');
  const characters: CharacterReference[] = charactersData?.characters || [];

  const maxShots = Math.ceil((brief.targetDurationSeconds || 30) / 10);

  // Persist draft to localStorage (debounced)
  useEffect(() => {
    if (!storyId) {
      const timeout = setTimeout(() => {
        saveDraft({ step, brief });
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [step, brief, storyId]);

  // Validation
  const validateStep = useCallback((stepNum: number) => {
    const newErrors: Record<string, string> = {};

    if (stepNum <= 1) {
      if (!brief.narrative.trim()) {
        newErrors.narrative = 'Story narrative is required';
      } else if (brief.narrative.length < 10) {
        newErrors.narrative = 'Narrative must be at least 10 characters';
      } else if (brief.narrative.length > 5000) {
        newErrors.narrative = 'Narrative must be less than 5000 characters';
      }

      if (!brief.targetDurationSeconds || brief.targetDurationSeconds < 1) {
        newErrors.duration = 'Duration must be at least 1 second';
      } else if (brief.targetDurationSeconds > 3600) {
        newErrors.duration = 'Duration cannot exceed 3600 seconds (1 hour)';
      }
    }

    if (stepNum <= 2) {
      if (brief.audioConfig?.musicSource === 'custom' && !brief.audioConfig.musicTrackId) {
        newErrors.music = 'Custom music track ID is required when using custom music';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [brief]);

  // Navigate to the story plan (story already created in step 2)
  const handleCreateStory = async () => {
    if (!validateStep(3)) return;

    clearDraft();
    notify.success('Story Created!', 'Your story has been created with a shot plan.');
    navigate(`/stories/${storyId}/plan`);
  };

  // Create story after step 2 to get a real storyId for character uploads
  const handleNext = async () => {
    if (!validateStep(step)) return;

    if (step === 2 && !storyId) {
      // Create story with minimal data to get a storyId
      setIsCreatingStory(true);
      try {
        const userId = getUserId();
        const result = await createStory.mutateAsync({ brief, userId });
        const newStoryId = result.storyId;
        if (newStoryId) {
          setStoryId(newStoryId);
          clearDraft();
          setStep(3);
        }
      } catch (err: any) {
        notify.error('Failed to create story', err.response?.data?.error || err.message);
      } finally {
        setIsCreatingStory(false);
      }
    } else {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    setStep(s => s - 1);
  };

  const updateBrief = (field: string, value: any) => {
    setBrief(prev => ({
      ...prev,
      [field]: value,
    }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const updateAudioConfig = (field: string, value: any) => {
    setBrief(prev => ({
      ...prev,
      audioConfig: { ...prev.audioConfig, [field]: value },
    }));
  };

  const handleCharacterUpload = (_character: CharacterReference) => {
    if (storyId) {
      queryClient.invalidateQueries({ queryKey: characterKeys.list(storyId) });
    }
    setCharacterUploadSuccess(true);
    setTimeout(() => setCharacterUploadSuccess(false), 3000);
  };

  const steps = [
    { number: 1, title: 'Story Brief', desc: 'Narrative, duration, format' },
    { number: 2, title: 'Audio & Style', desc: 'TTS voice, music, references' },
    { number: 3, title: 'Characters', desc: 'Upload character references' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Loading overlay during story creation */}
      {isCreatingStory && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-8 shadow-2xl text-center max-w-sm mx-4">
            <svg className="animate-spin h-12 w-12 text-primary-600 mx-auto mb-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Creating Your Story</h3>
            <p className="text-sm text-gray-500">Analyzing narrative, generating shot plan... This may take a moment.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button onClick={() => navigate(-1)} className="btn-ghost p-2">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">New Story</h1>
            <div className="w-10" />
          </div>

          {/* Progress Steps */}
          <div className="hidden md:flex mb-4">
            {steps.map((s, i) => (
              <div key={s.number} className="flex items-center flex-1">
                <div className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      i + 1 < step || (i + 1 === 3 && storyId)
                        ? 'bg-green-500 text-white'
                        : i + 1 === step
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {i + 1 < step || (i + 1 === 3 && storyId) ? (
                      <CheckCircleIcon className="w-5 h-5" />
                    ) : (
                      s.number
                    )}
                  </div>
                  <div className="ml-3">
                    <p className={`text-sm font-medium ${i + 1 <= step ? 'text-gray-900' : 'text-gray-500'}`}>
                      {s.title}
                    </p>
                    <p className="text-xs text-gray-500">{s.desc}</p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      i + 1 < step || (i + 1 === 2 && storyId) ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Step 1: Story Brief */}
          {step >= 1 && (
            <div className="card p-6 space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                  <CheckCircleIcon className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Story Brief</h2>
                  <p className="text-sm text-gray-500">Describe your video and set basic parameters</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="narrative" className="label">
                    Narrative <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="narrative"
                    value={brief.narrative}
                    onChange={(e) => updateBrief('narrative', e.target.value)}
                    rows={6}
                    placeholder="Describe your video story in detail. Include scenes, characters, actions, mood, and any specific visual elements you want..."
                    className={clsx('input', errors.narrative && 'border-red-500 focus:ring-red-500 focus:border-red-500')}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    {brief.narrative.length}/5000 characters
                  </p>
                  {errors.narrative && <p className="mt-1 text-sm text-red-600">{errors.narrative}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="duration" className="label">
                      Target Duration (seconds) <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="duration"
                      type="number"
                      value={brief.targetDurationSeconds}
                      onChange={(e) => updateBrief('targetDurationSeconds', parseInt(e.target.value) || 0)}
                      min="1"
                      max="3600"
                      className={clsx('input', errors.duration && 'border-red-500 focus:ring-red-500 focus:border-red-500')}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Estimated shots: ~{maxShots} (based on ~10s per shot)
                    </p>
                    {errors.duration && <p className="mt-1 text-sm text-red-600">{errors.duration}</p>}
                  </div>

                  <div>
                    <label htmlFor="aspect-ratio" className="label">Aspect Ratio</label>
                    <select
                      id="aspect-ratio"
                      value={brief.aspectRatio || '16:9'}
                      onChange={(e) => updateBrief('aspectRatio', e.target.value as any)}
                      className="input"
                    >
                      {ASPECT_RATIOS.map(ratio => (
                        <option key={ratio} value={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="resolution" className="label">Resolution</label>
                    <select
                      id="resolution"
                      value={brief.resolution || '1080p'}
                      onChange={(e) => updateBrief('resolution', e.target.value as any)}
                      className="input"
                    >
                      {RESOLUTIONS.map(res => (
                        <option key={res} value={res}>{res}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Negative Prompts (Optional)</label>
                  <textarea
                    value={brief.negativePrompts?.join('\n') || ''}
                    onChange={(e) => updateBrief('negativePrompts', e.target.value.split('\n').filter(Boolean))}
                    rows={3}
                    placeholder="Things to avoid: blurry, low quality, watermark, text, logo, ugly, deformed..."
                    className="input"
                  />
                  <p className="mt-1 text-sm text-gray-500">One per line</p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Audio & Style */}
          {step >= 2 && (
            <div className="card p-6 space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Audio & Style</h2>
                  <p className="text-sm text-gray-500">Configure voice, music, and visual style</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="tts-voice" className="label">TTS Voice</label>
                    <select
                      id="tts-voice"
                      value={brief.audioConfig?.ttsVoice || 'shivank'}
                      onChange={(e) => updateAudioConfig('ttsVoice', e.target.value)}
                      className="input"
                    >
                      <option value="shivank">Shivank (Default, Professional)</option>
                      <option value="deep_breath">Deep Breath (Calm, Meditative)</option>
                      <option value="suspense">Suspense (Dramatic, Tense)</option>
                      <option value="friendly">Friendly (Warm, Conversational)</option>
                      <option value="authoritative">Authoritative (Commanding, Clear)</option>
                      <option value="custom">Custom Voice ID...</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="tts-style" className="label">TTS Style</label>
                    <select
                      id="tts-style"
                      value={brief.audioConfig?.ttsStyle || 'narration'}
                      onChange={(e) => updateAudioConfig('ttsStyle', e.target.value)}
                      className="input"
                    >
                      <option value="narration">Narration</option>
                      <option value="conversational">Conversational</option>
                      <option value="documentary">Documentary</option>
                      <option value="commercial">Commercial</option>
                      <option value="storytelling">Storytelling</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Music Source</label>
                  <div className="flex flex-wrap gap-3">
                    {MUSIC_SOURCES.map(source => (
                      <label
                        key={source}
                        className={clsx(
                          'flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition',
                          brief.audioConfig?.musicSource === source
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        )}
                      >
                        <input
                          type="radio"
                          name="music-source"
                          value={source}
                          checked={brief.audioConfig?.musicSource === source}
                          onChange={(e) => updateAudioConfig('musicSource', e.target.value)}
                          className="w-4 h-4 text-primary-600"
                        />
                        <span className="capitalize">{source.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {brief.audioConfig?.musicSource === 'custom' && (
                  <div>
                    <label htmlFor="music-track" className="label">Custom Music Track ID</label>
                    <input
                      id="music-track"
                      type="text"
                      value={brief.audioConfig?.musicTrackId || ''}
                      onChange={(e) => updateAudioConfig('musicTrackId', e.target.value)}
                      placeholder="Enter track ID from your library"
                      className={clsx('input', errors.music && 'border-red-500')}
                    />
                    {errors.music && <p className="mt-1 text-sm text-red-600">{errors.music}</p>}
                  </div>
                )}

                {brief.audioConfig?.musicSource !== 'custom' && (
                  <div>
                    <label htmlFor="music-volume" className="label">
                      Music Volume: {Math.round((brief.audioConfig?.musicVolume || 0.3) * 100)}%
                    </label>
                    <input
                      id="music-volume"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={brief.audioConfig?.musicVolume || 0.3}
                      onChange={(e) => updateAudioConfig('musicVolume', parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                <div>
                  <label className="label">Style References (Optional)</label>
                  <textarea
                    value={brief.styleReferences?.join('\n') || ''}
                    onChange={(e) => updateBrief('styleReferences', e.target.value.split('\n').filter(Boolean))}
                    rows={3}
                    placeholder="Visual style references (one per line): cinematic, noir, vibrant colors, specific artist style..."
                    className="input"
                  />
                  <p className="mt-1 text-sm text-gray-500">One per line - used as style guidance for generation</p>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Characters */}
          {step >= 3 && (
            <div className="card p-6 space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Character References</h2>
                  <p className="text-sm text-gray-500">
                    Upload character images for consistent face generation across shots (Face-Lock)
                  </p>
                </div>
              </div>

              {storyId ? (
                <CharacterUploader
                  storyId={storyId}
                  userId={getUserId()}
                  onUpload={handleCharacterUpload}
                  existingCharacters={characters}
                />
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Creating story... Please wait.
                </div>
              )}

              {characterUploadSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
                  <CheckCircleIcon className="w-5 h-5 text-green-600" />
                  Character uploaded successfully! You can upload more or proceed to create your story.
                </div>
              )}

              {characters.length > 0 && (
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="font-medium text-gray-900 mb-3">Uploaded Characters</h3>
                  <div className="flex flex-wrap gap-2">
                    {characters.map((char) => (
                      <span key={char.id} className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm flex items-center gap-1">
                        {char.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className="btn-secondary"
            >
              ← Back
            </button>

            <div className="flex gap-3">
              {step < 3 && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isCreatingStory}
                  className="btn-primary"
                >
                  {isCreatingStory ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Creating story...
                    </span>
                  ) : 'Next →'}
                </button>
              )}
              {step === 3 && storyId && (
                <button
                  type="button"
                  onClick={handleCreateStory}
                  disabled={isSubmitting || createStory.isPending}
                  className="btn-primary"
                >
                  {isSubmitting || createStory.isPending ? 'Creating...' : 'Create Story'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Character Upload Modal */}
      <Modal
        isOpen={showCharacterModal}
        onClose={() => setShowCharacterModal(false)}
        title="Upload Character Reference"
        size="lg"
      >
        {storyId && (
          <CharacterUploader
            storyId={storyId}
            userId={getUserId()}
            onUpload={handleCharacterUpload}
            existingCharacters={characters}
          />
        )}
      </Modal>
    </div>
  );
}

export default StoryCreate;
