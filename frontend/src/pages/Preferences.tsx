import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useNotifications } from '../store/uiStore';
import apiClient from '../api/client';
import { getUserId } from '../utils/userId';

interface UserPreferences {
  preferredModel?: string;
  preferredQuality?: string;
  preferredTransition?: string;
  preferredResolution?: string;
  preferredAspectRatio?: string;
  preferredTtsVoice?: string;
  preferredTtsStyle?: string;
  autoDispatch?: boolean;
}

const DEFAULTS: UserPreferences = {
  preferredModel: 'auto',
  preferredQuality: 'high',
  preferredTransition: 'crossfade',
  preferredResolution: '1080p',
  preferredAspectRatio: '16:9',
  preferredTtsVoice: 'shivank',
  preferredTtsStyle: 'narration',
  autoDispatch: false,
};

const PREFERENCE_FIELDS: { key: keyof UserPreferences; label: string; options: { value: string; label: string }[] }[] = [
  {
    key: 'preferredModel',
    label: 'Preferred Model',
    options: [
      { value: 'auto', label: 'AUTO (System Default)' },
      { value: 'veo3-low', label: 'Veo 3 Low' },
      { value: 'veo3-high', label: 'Veo 3 High' },
      { value: 'runway-gen3', label: 'Runway Gen-3' },
    ],
  },
  {
    key: 'preferredQuality',
    label: 'Quality Preset',
    options: [
      { value: 'low', label: 'Low (Fast)' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'ultra', label: 'Ultra Realistic' },
    ],
  },
  {
    key: 'preferredTransition',
    label: 'Default Transition',
    options: [
      { value: 'crossfade', label: 'Cross-Fade' },
      { value: 'fade', label: 'Fade' },
      { value: 'slideleft', label: 'Slide Left' },
      { value: 'zoomin', label: 'Zoom In' },
      { value: 'dissolve', label: 'Dissolve' },
    ],
  },
  {
    key: 'preferredResolution',
    label: 'Default Resolution',
    options: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' },
      { value: '4K', label: '4K' },
    ],
  },
  {
    key: 'preferredAspectRatio',
    label: 'Default Aspect Ratio',
    options: [
      { value: '16:9', label: '16:9 (Landscape)' },
      { value: '9:16', label: '9:16 (Portrait)' },
      { value: '1:1', label: '1:1 (Square)' },
      { value: '4:5', label: '4:5 (Instagram)' },
    ],
  },
  {
    key: 'preferredTtsVoice',
    label: 'Default TTS Voice',
    options: [
      { value: 'shivank', label: 'Shivank (Professional)' },
      { value: 'deep_breath', label: 'Deep Breath (Calm)' },
      { value: 'suspense', label: 'Suspense (Dramatic)' },
      { value: 'friendly', label: 'Friendly (Warm)' },
      { value: 'authoritative', label: 'Authoritative (Clear)' },
    ],
  },
  {
    key: 'preferredTtsStyle',
    label: 'Default TTS Style',
    options: [
      { value: 'narration', label: 'Narration' },
      { value: 'conversational', label: 'Conversational' },
      { value: 'documentary', label: 'Documentary' },
      { value: 'commercial', label: 'Commercial' },
      { value: 'storytelling', label: 'Storytelling' },
    ],
  },
];

export function Preferences() {
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      setIsLoading(true);
      try {
        const response = await apiClient.getUserPreferences(getUserId());
        setPrefs({ ...DEFAULTS, ...response.data });
      } catch {
        // Use defaults on error
      } finally {
        setIsLoading(false);
      }
    };
    loadPreferences();
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await apiClient.updateUserPreferences(getUserId(), prefs as unknown as Record<string, unknown>);
      notify.success('Saved', 'Preferences updated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Save Failed', message);
    } finally {
      setIsSaving(false);
    }
  }, [prefs, notify]);

  const handleReset = useCallback(async () => {
    try {
      await apiClient.resetUserPreferences(getUserId());
      setPrefs(DEFAULTS);
      notify.success('Reset', 'Preferences reset to defaults');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset';
      notify.error('Reset Failed', message);
    }
  }, [notify]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 h-16">
            <button onClick={() => navigate('/')} className="btn-ghost p-2">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Preferences</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="card p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-gray-500">
              These preferences are learned from your usage and applied as defaults when creating new stories.
              Override any preference per-story as needed.
            </p>

            {/* Preference Fields */}
            <div className="card divide-y divide-gray-200">
              {PREFERENCE_FIELDS.map((field) => (
                <div key={field.key} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <label className="label mb-0">{field.label}</label>
                  </div>
                  <select
                    value={String(prefs[field.key] ?? '')}
                    onChange={(e) => setPrefs({ ...prefs, [field.key]: e.target.value })}
                    className="input w-56"
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* Boolean toggle */}
              <div className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <label className="label mb-0">Auto-Dispatch on Approval</label>
                  <p className="text-xs text-gray-500 mt-0.5">Skip prompt review and dispatch immediately</p>
                </div>
                <button
                  onClick={() => setPrefs({ ...prefs, autoDispatch: !prefs.autoDispatch })}
                  className={clsx(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    prefs.autoDispatch ? 'bg-primary-600' : 'bg-gray-200'
                  )}
                  role="switch"
                  aria-checked={prefs.autoDispatch}
                >
                  <span
                    className={clsx(
                      'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      prefs.autoDispatch ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button onClick={handleReset} className="btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50 flex items-center gap-2">
                <ArrowPathIcon className="w-4 h-4" />
                Reset to Defaults
              </button>
              <button onClick={handleSave} disabled={isSaving} className="btn-primary flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function clsx(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export default Preferences;
