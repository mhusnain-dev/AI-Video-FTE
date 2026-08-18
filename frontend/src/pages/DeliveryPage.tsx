import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  PlayIcon,
  PauseIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  DocumentTextIcon,
  MusicalNoteIcon,
  Cog6ToothIcon,
  EyeIcon,
  EyeSlashIcon,
  ExclamationTriangleIcon,
  ScissorsIcon as ScissorsIconType,
  PlusCircleIcon as PlusCircleIconType,
} from '@heroicons/react/24/outline';
import { useDelivery, useMergeStory, usePartialRegenerate, useDownloadUrl } from '../hooks/useStories';
import { useStory } from '../hooks/useStories';
import { useUIStore, useNotifications } from '../store/uiStore';
import { StatusBadge } from '../components/ShotCard';
import { MergeApprovalDialog } from '../components/MergeApprovalDialog';
import { Modal, ConfirmDialog } from '../components/Modal';
import { VideoPlayer } from '../components/VideoPlayer';
import type { DeliveryPackage, Shot, SubtitleInfo } from '../types/api';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';

export function DeliveryPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [showPartialRegen, setShowPartialRegen] = useState(false);
  const [selectedShots, setSelectedShots] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'subtitles' | 'logs' | 'reports' | 'cost'>('video');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('en');
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: delivery, isLoading, isError, refetch } = useDelivery(storyId || '');
  const mergeStory = useMergeStory();
  const partialRegenerate = usePartialRegenerate();
  const getDownloadUrl = useDownloadUrl(storyId || '');

  const { data: story } = useStory(storyId as string);

  if (story) {
    setCurrentStory(story.id);
  }

  const handleMerge = async () => {
    try {
      await mergeStory.mutateAsync({ storyId: storyId! });
      notify.success('Merge Started', 'Video merging has begun. This may take a few minutes.');
      refetch();
    } catch (err: any) {
      notify.error('Failed to Merge', err.response?.data?.error || err.message);
    }
  };

  const handlePartialRegen = async () => {
    if (selectedShots.length === 0) return;
    try {
      await partialRegenerate.mutateAsync({
        storyId: storyId!,
        shotIds: selectedShots,
        userId: getUserId(),
      });
      notify.success('Partial Regeneration Started', `${selectedShots.length} shot(s) will be regenerated.`);
      setShowPartialRegen(false);
      setSelectedShots([]);
      refetch();
    } catch (err: any) {
      notify.error('Failed to Regenerate', err.response?.data?.error || err.message);
    }
  };

  const handleDownload = async () => {
    if (!delivery?.data?.signedUrl) {
      setShowDownloadConfirm(true);
      return;
    }
    setDownloading(true);
    try {
      const result = await getDownloadUrl.mutateAsync(storyId!);
      // Trigger download
      const link = document.createElement('a');
      link.href = result.data?.signedUrl || delivery.data.signedUrl;
      link.download = `ai-video-fte-${storyId}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      notify.success('Download Started', 'Your video is downloading.');
    } catch (err: any) {
      notify.error('Download Failed', err.message);
    } finally {
      setDownloading(false);
    }
  };

  const toggleShotSelection = (shotId: string) => {
    setSelectedShots(prev =>
      prev.includes(shotId) ? prev.filter(id => id !== shotId) : [...prev, shotId]
    );
  };

  if (!storyId) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isError || !delivery?.data) {
    const storyData = story;
    const status = storyData?.status;
    const shots = storyData?.shotPlan || [];

    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <button onClick={() => navigate(`/stories/${storyId}/progress`)} className="btn-ghost p-2">
                  <ArrowLeftIcon className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-lg font-semibold text-gray-900">Video Delivery</h1>
                  <p className="text-sm text-gray-500">{storyData?.brief?.narrative?.substring(0, 80)}...</p>
                </div>
              </div>
              <StatusBadge status={status || 'draft'} type="story" size="md" />
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="card p-12 text-center">
            <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Video Not Ready</h2>
            <p className="text-gray-500 mb-6">
              {status === 'completed' ? 'Delivery package is being prepared.' : 'Story must be completed before video can be delivered.'}
            </p>
            {status !== 'completed' && shots.length > 0 && (
              <button onClick={handleMerge} disabled={mergeStory.isPending} className="btn-primary">
                {mergeStory.isPending ? 'Merging...' : 'Merge & Generate Video'}
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const pkg = delivery.data;
  const videoUrl = pkg.signedUrl || pkg.videoUrl;
  const expiry = pkg.signedUrlExpiresAt ? new Date(pkg.signedUrlExpiresAt) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/stories/${storyId}/progress`)} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Video Delivery</h1>
                <p className="text-sm text-gray-500">{story?.brief?.narrative?.substring(0, 80)}...</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge status={story?.status || 'completed'} type="story" size="md" />
              {expiry && (
                <div className="text-sm text-gray-500 hidden sm:block">
                  Link expires: {formatTimeRemaining(expiry)}
                </div>
              )}
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="border-t border-gray-200">
            <nav className="flex overflow-x-auto" aria-label="Delivery tabs">
              {[
                { id: 'video', label: 'Video', icon: PlayIcon },
                { id: 'subtitles', label: 'Subtitles', icon: DocumentTextIcon },
                { id: 'logs', label: 'Generation Logs', icon: Cog6ToothIcon },
                { id: 'reports', label: 'Verification Reports', icon: CheckCircleIcon },
                { id: 'cost', label: 'Cost Breakdown', icon: ArrowDownIcon },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  )}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'video' && (
          <VideoTab
            pkg={pkg}
            videoUrl={videoUrl}
            expiry={expiry}
            onDownload={handleDownload}
            downloading={downloading}
            subtitlesEnabled={subtitlesEnabled}
            onSubtitlesToggle={setSubtitlesEnabled}
            selectedSubtitle={selectedSubtitle}
            onSubtitleChange={setSelectedSubtitle}
          />
        )}

        {activeTab === 'subtitles' && (
          <SubtitlesTab
            pkg={pkg}
            selectedSubtitle={selectedSubtitle}
            onSubtitleChange={setSelectedSubtitle}
          />
        )}

        {activeTab === 'logs' && <LogsTab pkg={pkg} />}

        {activeTab === 'reports' && <ReportsTab pkg={pkg} />}

        {activeTab === 'cost' && <CostTab pkg={pkg} />}

        {/* Partial Regenerate Modal */}
        <Modal
          isOpen={showPartialRegen}
          onClose={() => setShowPartialRegen(false)}
          title="Partial Regeneration"
          size="lg"
        >
          <PartialRegenModal
            storyId={storyId!}
            shots={story?.shots || []}
            selectedShots={selectedShots}
            onToggleShot={toggleShotSelection}
            onConfirm={handlePartialRegen}
            onCancel={() => setShowPartialRegen(false)}
            isLoading={partialRegenerate.isPending}
          />
        </Modal>

        {/* Download Confirmation */}
        <ConfirmDialog
          isOpen={showDownloadConfirm}
          onClose={() => setShowDownloadConfirm(false)}
          onConfirm={handleDownload}
          title="Generate Download Link"
          message="No active download link found. Would you like to generate a new signed URL (valid for 7 days)?"
          confirmLabel="Generate & Download"
          variant="primary"
          isLoading={downloading}
        />

        {/* Merge Approval Dialog — shows when all shots complete */}
        {story && (
          <MergeApprovalDialog
            story={story}
            isOpen={story.status === 'pending_merge'}
            onClose={() => {}}
            onComplete={() => refetch()}
          />
        )}
      </main>
    </div>
  );
}

function VideoTab({
  pkg,
  videoUrl,
  expiry,
  onDownload,
  downloading,
  subtitlesEnabled,
  onSubtitlesToggle,
  selectedSubtitle,
  onSubtitleChange,
}: {
  pkg: DeliveryPackage;
  videoUrl: string;
  expiry: Date | null;
  onDownload: () => void;
  downloading: boolean;
  subtitlesEnabled: boolean;
  onSubtitlesToggle: (enabled: boolean) => void;
  selectedSubtitle: string;
  onSubtitleChange: (lang: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Video Player */}
      <div className="card overflow-hidden">
        <VideoPlayer
          src={videoUrl}
          poster={pkg.transitionTimeline[0]?.thumbnailUrl}
          subtitles={pkg.subtitles}
          subtitlesEnabled={subtitlesEnabled}
          selectedSubtitle={selectedSubtitle}
          onSubtitleChange={onSubtitleChange}
          onSubtitlesToggle={onSubtitlesToggle}
        />
      </div>

      {/* Download & Info */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-xl">
              <ArrowDownTrayIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Delivery Package Ready</h3>
              <p className="text-sm text-gray-500">
                Format: {pkg.format.toUpperCase()} • {pkg.resolution} • {pkg.durationSeconds}s • {formatFileSize(pkg.fileSizeBytes)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {expiry && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Link expires:</span> {formatTimeRemaining(expiry)}
              </div>
            )}
            <button onClick={onDownload} disabled={downloading} className="btn-primary">
              {downloading ? 'Preparing...' : 'Download Video'}
            </button>
          </div>
        </div>
      </div>

      {/* Transition Timeline */}
      {pkg.transitionTimeline?.length && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Transition Timeline</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-gray-500">Shot</th>
                  <th className="px-4 py-2 text-left text-gray-500">Transition</th>
                  <th className="px-4 py-2 text-left text-gray-500">Duration</th>
                  <th className="px-4 py-2 text-left text-gray-500">Start Time</th>
                  <th className="px-4 py-2 text-left text-gray-500">End Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pkg.transitionTimeline.map((t, i) => (
                  <tr key={t.shotId} className="hover:bg-gray-50">
                    <td className="px-4 py-2">#{i + 1}</td>
                    <td className="px-4 py-2 capitalize">{t.transition.type}</td>
                    <td className="px-4 py-2">{t.transition.durationSeconds}s</td>
                    <td className="px-4 py-2">{formatTime(t.startTime)}</td>
                    <td className="px-4 py-2">{formatTime(t.endTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SubtitlesTab({ pkg, selectedSubtitle, onSubtitleChange }: { pkg: DeliveryPackage; selectedSubtitle: string; onSubtitleChange: (lang: string) => void }) {
  const subtitles = pkg.subtitles;

  if (!subtitles || (!subtitles.srtUrl && !subtitles.vttUrl && !subtitles.assUrl)) {
    return (
      <div className="card p-12 text-center">
        <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Subtitles Available</h3>
        <p className="text-gray-500">Subtitles will be generated during the merge process.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-4">Available Subtitles</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { format: 'SRT', url: subtitles.srtUrl, label: 'SubRip (.srt)', desc: 'Most compatible format' },
            { format: 'VTT', url: subtitles.vttUrl, label: 'WebVTT (.vtt)', desc: 'Web standard, supports styling' },
            { format: 'ASS', url: subtitles.assUrl, label: 'Advanced SubStation (.ass)', desc: 'Advanced styling & positioning' },
          ].map(({ format, url, label, desc }) => (
            <div key={format} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{label}</span>
                {url && (
                  <a href={url} download className="btn-secondary text-sm">
                    <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                    Download
                  </a>
                )}
              </div>
              <p className="text-sm text-gray-500">{desc}</p>
              {!url && <p className="text-sm text-gray-400 mt-2">Not generated</p>}
            </div>
          ))}
        </div>
      </div>

      <SubtitlePreview subtitles={subtitles} />
    </div>
  );
}

function SubtitlePreview({ subtitles }: { subtitles: SubtitleInfo }) {
  const [previewContent, setPreviewContent] = useState<string>('');

  useEffect(() => {
    if (subtitles.vttUrl) {
      fetch(subtitles.vttUrl)
        .then(r => r.text())
        .then(t => setPreviewContent(t))
        .catch(() => setPreviewContent('Unable to load preview'));
    }
  }, [subtitles.vttUrl]);

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 mb-3">Preview (VTT)</h3>
      <div className="bg-gray-900 rounded p-4 max-h-96 overflow-auto font-mono text-sm text-gray-100">
        <pre>{previewContent || 'Loading...'}</pre>
      </div>
    </div>
  );
}

function LogsTab({ pkg }: { pkg: DeliveryPackage }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 mb-3">Generation Logs</h3>
      <div className="bg-gray-900 rounded p-4 max-h-96 overflow-auto font-mono text-sm text-gray-100">
        <pre>{pkg.costBreakdown ? JSON.stringify(pkg.costBreakdown, null, 2) : 'No logs available'}</pre>
      </div>
    </div>
  );
}

function ReportsTab({ pkg }: { pkg: DeliveryPackage }) {
  const reports = pkg.verificationReports;

  return (
    <div className="space-y-6">
      {/* Face-Lock Reports */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Face-Lock Verification</h3>
        {reports?.faceLock?.length ? (
          <div className="space-y-3">
            {reports.faceLock.map((r, i) => (
              <div key={i} className="p-3 border rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.shotId.substring(0, 8)} - {r.characterName}</p>
                    <p className="text-sm text-gray-500">Model: {r.model}</p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('font-medium', r.passed ? 'text-green-600' : 'text-red-600')}>
                      {r.passed ? 'Verified' : 'Failed'}
                    </p>
                    <p className="text-sm text-gray-500">{(r.similarityScore * 100).toFixed(1)}% / {(r.threshold * 100).toFixed(1)}%</p>
                    {r.retries > 0 && <p className="text-xs text-yellow-600">Retries: {r.retries}</p>}
                    {r.autoRegenerated && <p className="text-xs text-blue-600">Auto-regenerated</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No Face-Lock reports available</p>
        )}
      </div>

      {/* Cross-Shot Consistency */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Cross-Shot Consistency</h3>
        {reports?.crossShotConsistency ? (
          <div className="space-y-3">
            {reports.crossShotConsistency.shotScores.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded">
                <span className="text-sm">{s.shotId.substring(0, 8)}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div className={clsx('h-full rounded-full', s.score >= 0.8 ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${s.score * 100}%` }} />
                  </div>
                  <span className={clsx('text-sm font-medium', s.score >= 0.8 ? 'text-green-600' : 'text-red-600')}>
                    {(s.score * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t">
              <span className={clsx('font-medium', reports.crossShotConsistency.overallPassed ? 'text-green-600' : 'text-red-600')}>
                Overall: {reports.crossShotConsistency.overallPassed ? 'Consistent' : 'Inconsistent'}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">No cross-shot consistency report available</p>
        )}
      </div>

      {/* Sacred Guard Audit */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Sacred Guard Audit</h3>
        {reports?.sacredGuard?.length ? (
          <div className="space-y-2">
            {reports.sacredGuard.map((entry, i) => (
              <div key={i} className="p-3 border rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{entry.shotId.substring(0, 8)}</p>
                    <p className="text-sm text-gray-500">{entry.trigger} • {(entry.similarityScore * 100).toFixed(1)}% similarity</p>
                  </div>
                  <span className={clsx('px-2 py-1 rounded-full text-xs font-medium',
                      entry.action === 'blocked' ? 'bg-red-100 text-red-700' :
                      entry.action === 'flagged' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700')}>
                    {entry.action.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No Sacred Guard audit entries</p>
        )}
      </div>
    </div>
  );
}

function CostTab({ pkg }: { pkg: DeliveryPackage }) {
  const cost = pkg.costBreakdown;

  if (!cost) {
    return (
      <div className="card p-12 text-center">
        <ArrowDownTrayIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Cost Data</h3>
        <p className="text-gray-500">Cost breakdown will be available after generation completes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-4">Cost Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CostStat label="Total Estimated" value={`$${cost.totalEstimatedUsd.toFixed(2)}`} color="blue" />
          <CostStat label="Total Actual" value={`$${cost.totalActualUsd.toFixed(2)}`} color="green" />
          <CostStat label="Budget Used" value={`${cost.budgetUsedPercentage.toFixed(1)}%`} color="orange" />
          <CostStat label="Drift Alerts" value={String(cost.driftAlerts.length)} color={cost.driftAlerts.length > 0 ? 'red' : 'green'} />
        </div>
      </div>

      {/* Per-Shot Breakdown */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Per-Shot Costs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2 text-left text-gray-500">Shot</th>
                <th className="px-4 py-2 text-left text-gray-500">Model</th>
                <th className="px-4 py-2 text-right text-gray-500">Estimated</th>
                <th className="px-4 py-2 text-right text-gray-500">Actual</th>
                <th className="px-4 py-2 text-right text-gray-500">Drift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cost.perShot.map((shot) => (
                <tr key={shot.shotId} className="hover:bg-gray-50">
                  <td className="px-4 py-2">#{shot.shotId.substring(0, 8)}</td>
                  <td className="px-4 py-2">{shot.model}</td>
                  <td className="px-4 py-2 text-right">${shot.estimatedUsd.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right font-medium">${shot.actualUsd.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={clsx('font-medium', shot.driftPercentage > 50 ? 'text-red-600' : shot.driftPercentage > 20 ? 'text-yellow-600' : 'text-green-600')}>
                      {shot.driftPercentage >= 0 ? '+' : ''}{shot.driftPercentage.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drift Alerts */}
      {cost.driftAlerts.length > 0 && (
        <div className="card p-4 border-red-200 bg-red-50">
          <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5" />
            Cost Drift Alerts
          </h3>
          <ul className="space-y-2">
            {cost.driftAlerts.map((alert, i) => (
              <li key={i} className="text-sm text-red-700 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full" />
                Shot {alert.shotId.substring(0, 8)}: {alert.type} drift of {(alert.actual * 100).toFixed(1)}% (threshold: {(alert.threshold * 100).toFixed(1)}%)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CostStat({ label, value, color }: { label: string; value: string; color: string }) {
  const colorClasses = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    orange: 'text-orange-600',
    red: 'text-red-600',
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={clsx('text-2xl font-bold', colorClasses[color as keyof typeof colorClasses])}>{value}</p>
    </div>
  );
}

function PartialRegenModal({
  storyId,
  shots,
  selectedShots,
  onToggleShot,
  onConfirm,
  onCancel,
  isLoading,
}: {
  storyId: string;
  shots: Shot[];
  selectedShots: string[];
  onToggleShot: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-gray-600">
        Select shots to regenerate. Only selected shots will be re-processed through the full pipeline
        (admission, generation, Face-Lock verification). Other shots remain unchanged.
      </p>

      <div className="max-h-64 overflow-y-auto space-y-2">
        {shots.map((shot) => (
          <label key={shot.id} className={clsx(
              'flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition',
              selectedShots.includes(shot.id) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
            )}>
            <input
              type="checkbox"
              checked={selectedShots.includes(shot.id)}
              onChange={() => onToggleShot(shot.id)}
              className="w-4 h-4 text-primary-600"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{shot.visualDescription}</p>
              <p className="text-sm text-gray-500">
                Shot #{shot.orderIndex + 1} • {shot.status} • {shot.durationSeconds}s
              </p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button onClick={onCancel} className="btn-secondary" disabled={isLoading}>Cancel</button>
        <button onClick={onConfirm} className="btn-primary" disabled={isLoading || selectedShots.length === 0}>
          {isLoading ? 'Starting...' : `Regenerate ${selectedShots.length} Shot(s)`}
        </button>
      </div>
    </div>
  );
}

function formatTimeRemaining(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default DeliveryPage;