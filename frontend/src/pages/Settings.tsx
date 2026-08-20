import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  ClockIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  FilmIcon,
  MusicalNoteIcon,
  LockClosedIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { useNotifications } from '../store/uiStore';
import {
  useUserModelPriority,
  useUpdateUserModelPriority,
  useSacredGuardThresholds,
  useUpdateSacredGuardThresholds,
  useUserSettings,
  useUpdateUserSettings,
} from '../hooks/useStories';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';
import type { ElementType } from 'react';
import { TemperatureSlider } from '../components/TemperatureSlider';

type SettingsTab = 'models' | 'cost' | 'rate-limits' | 'sacred-guard' | 'face-lock' | 'transitions' | 'audio' | 'security' | 'video';

const TABS: { id: SettingsTab; label: string; icon: ElementType }[] = [
  { id: 'models', label: 'Models', icon: CpuChipIcon },
  { id: 'cost', label: 'Cost', icon: CurrencyDollarIcon },
  { id: 'rate-limits', label: 'Rate Limits', icon: ClockIcon },
  { id: 'sacred-guard', label: 'Sacred Guard', icon: ShieldCheckIcon },
  { id: 'face-lock', label: 'Face-Lock', icon: UserGroupIcon },
  { id: 'transitions', label: 'Transitions', icon: FilmIcon },
  { id: 'audio', label: 'Audio', icon: MusicalNoteIcon },
  { id: 'security', label: 'Security', icon: LockClosedIcon },
  { id: 'video', label: 'Video', icon: VideoCameraIcon },
];

const MODELS = ['veo3-low', 'veo3-high', 'runway-gen3'];

interface UserSettingsData {
  cost?: {
    estimates?: Record<string, number>;
    singleShotDrift?: number;
    rollingDrift?: number;
    userBudget?: number;
    projectCeiling?: number;
  };
  rateLimits?: {
    perModel?: Record<string, number>;
    perUser?: number;
    global?: number;
  };
  faceLock?: {
    thresholds?: Record<string, number>;
    maxRetries?: number;
  };
  transitions?: {
    defaultType?: string;
    defaultDuration?: number;
  };
  audio?: {
    defaultVoice?: string;
    defaultStyle?: string;
  };
  video?: {
    defaultResolution?: string;
    defaultAspectRatio?: string;
  };
}

export function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const userId = getUserId();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 h-16">
            <button onClick={() => navigate('/')} className="btn-ghost p-2">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          <nav className="lg:col-span-1 mb-6 lg:mb-0">
            <div className="card p-2 space-y-1 sticky top-24">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                    activeTab === tab.id
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                >
                  <tab.icon className="w-5 h-5 flex-shrink-0" />
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="lg:col-span-3">
            {activeTab === 'models' && <ModelsSettings userId={userId} />}
            {activeTab === 'cost' && <CostSettings userId={userId} />}
            {activeTab === 'rate-limits' && <RateLimitSettings userId={userId} />}
            {activeTab === 'sacred-guard' && <SacredGuardSettings />}
            {activeTab === 'face-lock' && <FaceLockSettings userId={userId} />}
            {activeTab === 'transitions' && <TransitionSettings userId={userId} />}
            {activeTab === 'audio' && <AudioSettings userId={userId} />}
            {activeTab === 'security' && <SecuritySettings />}
            {activeTab === 'video' && <VideoSettings userId={userId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

function useSettingsState(userId: string) {
  const { data: settings, isLoading } = useUserSettings(userId);
  const updateSettings = useUpdateUserSettings();
  return { settings: (settings ?? {}) as UserSettingsData, isLoading, updateSettings };
}

function ModelsSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { data: priority } = useUserModelPriority(userId);
  const updatePriority = useUpdateUserModelPriority();

  const [priorityList, setPriorityList] = useState<string[]>(
    priority?.data?.priorityList ?? ['veo3-low', 'veo3-high', 'runway-gen3']
  );
  const [useSystemDefault, setUseSystemDefault] = useState(priority?.data?.useSystemDefault ?? true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (priority?.data) {
      setPriorityList(priority.data.priorityList ?? ['veo3-low', 'veo3-high', 'runway-gen3']);
      setUseSystemDefault(priority.data.useSystemDefault ?? true);
    }
  }, [priority?.data]);

  const handleReorder = (from: number, to: number) => {
    const newList = [...priorityList];
    const [item] = newList.splice(from, 1);
    newList.splice(to, 0, item);
    setPriorityList(newList);
  };

  const handleSave = async () => {
    try {
      await updatePriority.mutateAsync({ userId, priorityList, useSystemDefault });
      notify.success('Saved', 'Model priority updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Model Priority (CL-006)"
      description="Configure your preferred order of video generation models."
    >
      <label className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg cursor-pointer">
        <input
          type="checkbox"
          checked={useSystemDefault}
          onChange={(e) => setUseSystemDefault(e.target.checked)}
          className="w-4 h-4 text-primary-600"
        />
        <div>
          <span className="font-medium text-gray-900">Use System Default Priority</span>
          <p className="text-sm text-gray-500">veo3-low → veo3-high → runway-gen3</p>
        </div>
      </label>

      {!useSystemDefault && (
        <div className="space-y-2 mb-4">
          <p className="text-sm font-medium text-gray-700">Drag to reorder your priority:</p>
          {priorityList.map((model, i) => (
            <div
              key={model}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIndex !== null) handleReorder(dragIndex, i); setDragIndex(null); }}
              className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg cursor-grab active:cursor-grabbing hover:border-primary-300"
            >
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-medium">{i + 1}</span>
              <span className="font-medium text-gray-900">{model}</span>
              <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
            </div>
          ))}
        </div>
      )}

      <button onClick={handleSave} disabled={updatePriority.isPending} className="btn-primary">
        {updatePriority.isPending ? 'Saving...' : 'Save Model Priority'}
      </button>

      <TemperatureSlider />
    </SettingsCard>
  );
}

function CostSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [estimates, setEstimates] = useState<Record<string, number>>(settings.cost?.estimates ?? {
    'veo3-low': 0.00,
    'veo3-high': 0.05,
    'runway-gen3': 0.08,
  });
  const [singleShotDrift, setSingleShotDrift] = useState(settings.cost?.singleShotDrift ?? 0.50);
  const [rollingDrift, setRollingDrift] = useState(settings.cost?.rollingDrift ?? 0.20);
  const [userBudget, setUserBudget] = useState(settings.cost?.userBudget ?? 100);
  const [projectCeiling, setProjectCeiling] = useState(settings.cost?.projectCeiling ?? 500);

  useEffect(() => {
    if (settings.cost) {
      if (settings.cost.estimates) setEstimates(settings.cost.estimates);
      if (settings.cost.singleShotDrift !== undefined) setSingleShotDrift(settings.cost.singleShotDrift);
      if (settings.cost.rollingDrift !== undefined) setRollingDrift(settings.cost.rollingDrift);
      if (settings.cost.userBudget !== undefined) setUserBudget(settings.cost.userBudget);
      if (settings.cost.projectCeiling !== undefined) setProjectCeiling(settings.cost.projectCeiling);
    }
  }, [settings.cost]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { cost: { estimates, singleShotDrift, rollingDrift, userBudget, projectCeiling } } });
      notify.success('Saved', 'Cost settings updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <>
      <SettingsCard title="Per-Model Cost Estimates (CL-010)" description="Cost per second for each model (USD)">
        <div className="grid grid-cols-2 gap-4">
          {MODELS.map((model) => (
            <div key={model}>
              <label className="label">{model}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={estimates[model] ?? 0}
                  onChange={(e) => setEstimates({ ...estimates, [model]: parseFloat(e.target.value) || 0 })}
                  className="input pl-7"
                />
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Drift Thresholds (CL-011)" description="Alert when actual costs exceed estimates by these percentages">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Single-Shot Drift: {(singleShotDrift * 100).toFixed(0)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={singleShotDrift} onChange={(e) => setSingleShotDrift(parseFloat(e.target.value))} className="w-full" />
          </div>
          <div>
            <label className="label">Rolling Average Drift: {(rollingDrift * 100).toFixed(0)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={rollingDrift} onChange={(e) => setRollingDrift(parseFloat(e.target.value))} className="w-full" />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Budget Limits" description="Maximum spend per user and project">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">User Budget (USD)</label>
            <input type="number" value={userBudget} onChange={(e) => setUserBudget(parseFloat(e.target.value) || 0)} className="input" />
          </div>
          <div>
            <label className="label">Project Ceiling (USD)</label>
            <input type="number" value={projectCeiling} onChange={(e) => setProjectCeiling(parseFloat(e.target.value) || 0)} className="input" />
          </div>
        </div>
        <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary mt-4">
          {updateSettings.isPending ? 'Saving...' : 'Save Cost Settings'}
        </button>
      </SettingsCard>
    </>
  );
}

function RateLimitSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [perModel, setPerModel] = useState<Record<string, number>>(settings.rateLimits?.perModel ?? {
    'veo3-low': 10,
    'veo3-high': 5,
    'runway-gen3': 5,
  });
  const [perUser, setPerUser] = useState(settings.rateLimits?.perUser ?? 20);
  const [globalLimit, setGlobalLimit] = useState(settings.rateLimits?.global ?? 100);

  useEffect(() => {
    if (settings.rateLimits) {
      if (settings.rateLimits.perModel) setPerModel(settings.rateLimits.perModel);
      if (settings.rateLimits.perUser !== undefined) setPerUser(settings.rateLimits.perUser);
      if (settings.rateLimits.global !== undefined) setGlobalLimit(settings.rateLimits.global);
    }
  }, [settings.rateLimits]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { rateLimits: { perModel, perUser, global: globalLimit } } });
      notify.success('Saved', 'Rate limits updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard title="Rate Limits (CL-012)" description="Requests per minute limits per model, user, and globally">
      <div className="space-y-4">
        <div>
          <h3 className="font-medium text-gray-700 mb-2">Per-Model Limits (req/min)</h3>
          <div className="grid grid-cols-2 gap-4">
            {MODELS.map((model) => (
              <div key={model}>
                <label className="label">{model}</label>
                <input type="number" value={perModel[model] ?? 0} onChange={(e) => setPerModel({ ...perModel, [model]: parseInt(e.target.value) || 0 })} className="input" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Per-User Limit</label>
            <input type="number" value={perUser} onChange={(e) => setPerUser(parseInt(e.target.value) || 0)} className="input" />
          </div>
          <div>
            <label className="label">Global Limit</label>
            <input type="number" value={globalLimit} onChange={(e) => setGlobalLimit(parseInt(e.target.value) || 0)} className="input" />
          </div>
        </div>
        <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary">
          {updateSettings.isPending ? 'Saving...' : 'Save Rate Limits'}
        </button>
      </div>
    </SettingsCard>
  );
}

function SacredGuardSettings() {
  const { notify } = useNotifications();
  const { data: thresholds } = useSacredGuardThresholds();
  const updateThresholds = useUpdateSacredGuardThresholds();

  const [perModel, setPerModel] = useState<Record<string, number>>({
    'veo3-low': 0.78,
    'veo3-high': 0.77,
    'runway-gen3': 0.79,
  });
  const [dualApprove, setDualApprove] = useState(false);

  useEffect(() => {
    if (thresholds?.data) {
      if (thresholds.data.perModelThresholds) setPerModel(thresholds.data.perModelThresholds);
      if (thresholds.data.dualApprove !== undefined) setDualApprove(thresholds.data.dualApprove);
    }
  }, [thresholds?.data]);

  const handleSave = async () => {
    try {
      await updateThresholds.mutateAsync({ perModelThresholds: perModel, dualApprove });
      notify.success('Saved', 'Sacred Guard thresholds updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Sacred Guard Thresholds (CL-001)"
      description="Visual similarity thresholds (0.75-0.80) for protecting against unauthorized likenesses. Higher = stricter."
    >
      <div className="space-y-4">
        {MODELS.map((model) => (
          <div key={model}>
            <label className="label">{model}: {perModel[model]?.toFixed(2) ?? '0.78'}</label>
            <input
              type="range"
              min="0.70"
              max="0.85"
              step="0.01"
              value={perModel[model] ?? 0.78}
              onChange={(e) => setPerModel({ ...perModel, [model]: parseFloat(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0.70 (lenient)</span>
              <span>0.85 (strict)</span>
            </div>
          </div>
        ))}

        <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
          <input type="checkbox" checked={dualApprove} onChange={(e) => setDualApprove(e.target.checked)} className="w-4 h-4 text-primary-600" />
          <div>
            <span className="font-medium text-gray-900">Require Dual-Approve (CL-009)</span>
            <p className="text-sm text-gray-500">Borderline cases require two administrator approvals</p>
          </div>
        </label>

        <button onClick={handleSave} disabled={updateThresholds.isPending} className="btn-primary">
          {updateThresholds.isPending ? 'Saving...' : 'Save Sacred Guard Settings'}
        </button>
      </div>
    </SettingsCard>
  );
}

function FaceLockSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [thresholds, setThresholds] = useState<Record<string, number>>(settings.faceLock?.thresholds ?? {
    'veo3-low': 0.82,
    'veo3-high': 0.80,
    'runway-gen3': 0.85,
  });
  const [maxRetries, setMaxRetries] = useState(settings.faceLock?.maxRetries ?? 2);

  useEffect(() => {
    if (settings.faceLock) {
      if (settings.faceLock.thresholds) setThresholds(settings.faceLock.thresholds);
      if (settings.faceLock.maxRetries !== undefined) setMaxRetries(settings.faceLock.maxRetries);
    }
  }, [settings.faceLock]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { faceLock: { thresholds, maxRetries } } });
      notify.success('Saved', 'Face-Lock settings updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Face-Lock Thresholds (CL-002, CL-003)"
      description="Minimum face similarity scores per model and maximum retry attempts before verification is exhausted."
    >
      <div className="space-y-4">
        {MODELS.map((model) => (
          <div key={model}>
            <label className="label">{model}: {thresholds[model]?.toFixed(2) ?? '0.82'}</label>
            <input
              type="range"
              min="0.70"
              max="0.95"
              step="0.01"
              value={thresholds[model] ?? 0.82}
              onChange={(e) => setThresholds({ ...thresholds, [model]: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
        ))}

        <div>
          <label className="label">Max Retries per Shot: {maxRetries}</label>
          <input type="range" min="0" max="5" step="1" value={maxRetries} onChange={(e) => setMaxRetries(parseInt(e.target.value))} className="w-full" />
        </div>

        <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary">
          {updateSettings.isPending ? 'Saving...' : 'Save Face-Lock Settings'}
        </button>
      </div>
    </SettingsCard>
  );
}

function TransitionSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [defaultType, setDefaultType] = useState(settings.transitions?.defaultType ?? 'crossfade');
  const [defaultDuration, setDefaultDuration] = useState(settings.transitions?.defaultDuration ?? 0.5);

  useEffect(() => {
    if (settings.transitions) {
      if (settings.transitions.defaultType) setDefaultType(settings.transitions.defaultType);
      if (settings.transitions.defaultDuration !== undefined) setDefaultDuration(settings.transitions.defaultDuration);
    }
  }, [settings.transitions]);

  const FFMPEG_FILTERS = [
    'crossfade', 'fade', 'fadeblack', 'fadewhite', 'slideleft', 'slideright',
    'slideup', 'slidedown', 'zoomin', 'circleopen', 'circleclose', 'wipeleft',
    'wiperight', 'wipeup', 'wipedown', 'dissolve', 'pixelize', 'radial',
    'smoothleft', 'smoothright', 'diagtl',
  ];

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { transitions: { defaultType, defaultDuration } } });
      notify.success('Saved', 'Transition settings updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Transitions (CL-014, CL-020)"
      description="Default transition between shots. 21 FFmpeg xfade presets available."
    >
      <div className="space-y-4">
        <div>
          <label className="label">Default Transition Filter</label>
          <select value={defaultType} onChange={(e) => setDefaultType(e.target.value)} className="input">
            {FFMPEG_FILTERS.map((filter) => (
              <option key={filter} value={filter}>{filter}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Default Duration: {defaultDuration}s</label>
          <input type="range" min="0.1" max="2" step="0.1" value={defaultDuration} onChange={(e) => setDefaultDuration(parseFloat(e.target.value))} className="w-full" />
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            <strong>Preview:</strong> {defaultType} transition, {defaultDuration}s duration
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-16 h-10 bg-primary-200 rounded" />
            <div className="flex-1 h-1 bg-gradient-to-r from-primary-200 to-purple-200 rounded" />
            <div className="w-16 h-10 bg-purple-200 rounded" />
          </div>
        </div>

        <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary">
          {updateSettings.isPending ? 'Saving...' : 'Save Transition Settings'}
        </button>
      </div>
    </SettingsCard>
  );
}

function AudioSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [activeSubTab, setActiveSubTab] = useState<'voice' | 'music'>('voice');
  const [defaultVoice, setDefaultVoice] = useState(settings.audio?.defaultVoice ?? 'shivank');
  const [defaultStyle, setDefaultStyle] = useState(settings.audio?.defaultStyle ?? 'narration');

  useEffect(() => {
    if (settings.audio) {
      if (settings.audio.defaultVoice) setDefaultVoice(settings.audio.defaultVoice);
      if (settings.audio.defaultStyle) setDefaultStyle(settings.audio.defaultStyle);
    }
  }, [settings.audio]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { audio: { defaultVoice, defaultStyle } } });
      notify.success('Saved', 'Audio settings updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Audio Configuration (CL-013, CL-022)"
      description="ElevenLabs TTS voices and music library configuration."
    >
      <div className="flex gap-2 mb-4">
        <button onClick={() => setActiveSubTab('voice')} className={clsx('px-4 py-2 rounded-lg text-sm font-medium', activeSubTab === 'voice' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600')}>
          Voice (TTS)
        </button>
        <button onClick={() => setActiveSubTab('music')} className={clsx('px-4 py-2 rounded-lg text-sm font-medium', activeSubTab === 'music' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600')}>
          Music Library
        </button>
      </div>

      {activeSubTab === 'voice' ? (
        <div className="space-y-4">
          <div>
            <label className="label">Default TTS Voice (ElevenLabs)</label>
            <select value={defaultVoice} onChange={(e) => setDefaultVoice(e.target.value)} className="input">
              <option value="shivank">Shivank (Professional)</option>
              <option value="deep_breath">Deep Breath (Calm)</option>
              <option value="suspense">Suspense (Dramatic)</option>
              <option value="friendly">Friendly (Warm)</option>
              <option value="authoritative">Authoritative (Clear)</option>
            </select>
          </div>
          <div>
            <label className="label">Default Style</label>
            <select value={defaultStyle} onChange={(e) => setDefaultStyle(e.target.value)} className="input">
              <option value="narration">Narration</option>
              <option value="conversational">Conversational</option>
              <option value="documentary">Documentary</option>
              <option value="commercial">Commercial</option>
              <option value="storytelling">Storytelling</option>
            </select>
          </div>
          <button className="btn-secondary">Preview Voice</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium text-gray-900 mb-2">Royalty-Free Library</h3>
              <p className="text-sm text-gray-500 mb-3">YouTube Audio Library + free sources</p>
              <button className="btn-secondary text-sm w-full">Browse Royalty-Free</button>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium text-gray-900 mb-2">ElevenLabs Library</h3>
              <p className="text-sm text-gray-500 mb-3">AI-generated music & soundscapes</p>
              <button className="btn-secondary text-sm w-full">Browse ElevenLabs</button>
            </div>
          </div>
          <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
            <p className="text-sm text-gray-500">Or upload custom music track</p>
            <button className="btn-ghost text-sm mt-2">Upload Custom Track</button>
          </div>
        </div>
      )}

      <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary mt-4">
        {updateSettings.isPending ? 'Saving...' : 'Save Audio Settings'}
      </button>
    </SettingsCard>
  );
}

function SecuritySettings() {
  return (
    <SettingsCard
      title="Security (CL-017)"
      description="Encryption and key rotation configuration."
    >
      <div className="space-y-4">
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-3">
            <LockClosedIcon className="w-6 h-6 text-green-600" />
            <div>
              <p className="font-medium text-green-800">Vault Transit Encryption Active</p>
              <p className="text-sm text-green-700">AES-256-GCM envelope encryption for biometric data</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Key Rotation Interval</p>
            <p className="text-2xl font-bold text-gray-900">90 days</p>
            <p className="text-xs text-gray-400 mt-1">Automated, zero-downtime</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Next Rotation</p>
            <p className="text-2xl font-bold text-gray-900">~72 days</p>
            <p className="text-xs text-gray-400 mt-1">Auto re-encryption on rotation</p>
          </div>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-medium text-gray-900 mb-2">Transit Key</h3>
          <code className="text-sm bg-gray-100 px-2 py-1 rounded">biometric-encryption</code>
        </div>
      </div>
    </SettingsCard>
  );
}

function VideoSettings({ userId }: { userId: string }) {
  const { notify } = useNotifications();
  const { settings, updateSettings } = useSettingsState(userId);

  const [defaultResolution, setDefaultResolution] = useState(settings.video?.defaultResolution ?? '1080p');
  const [defaultAspectRatio, setDefaultAspectRatio] = useState(settings.video?.defaultAspectRatio ?? '16:9');

  useEffect(() => {
    if (settings.video) {
      if (settings.video.defaultResolution) setDefaultResolution(settings.video.defaultResolution);
      if (settings.video.defaultAspectRatio) setDefaultAspectRatio(settings.video.defaultAspectRatio);
    }
  }, [settings.video]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({ userId, settings: { video: { defaultResolution, defaultAspectRatio } } });
      notify.success('Saved', 'Video settings updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      notify.error('Failed', message);
    }
  };

  return (
    <SettingsCard
      title="Video Defaults (CL-015, CL-018)"
      description="Default resolution and aspect ratio for new stories."
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Default Resolution</label>
          <select value={defaultResolution} onChange={(e) => setDefaultResolution(e.target.value)} className="input">
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </div>
        <div>
          <label className="label">Default Aspect Ratio</label>
          <select value={defaultAspectRatio} onChange={(e) => setDefaultAspectRatio(e.target.value)} className="input">
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait/Reels)</option>
            <option value="1:1">1:1 (Square)</option>
            <option value="4:5">4:5 (Instagram)</option>
          </select>
        </div>
      </div>
      <button onClick={handleSave} disabled={updateSettings.isPending} className="btn-primary mt-4">
        {updateSettings.isPending ? 'Saving...' : 'Save Video Settings'}
      </button>
    </SettingsCard>
  );
}

export default Settings;
