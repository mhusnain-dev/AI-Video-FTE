import { useState, useEffect } from 'react';
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useStory } from '../hooks/useStories';
import { useStoryStream } from '../hooks/useStoryStream';
import { useUIStore, useNotifications } from '../store/uiStore';
import { ProgressTimeline } from '../components/ProgressTimeline';
import { StatusBadge } from '../components/ShotCard';
import { Modal } from '../components/Modal';
import type { Story, Shot, AdmissionResult, FaceLockResult } from '../types/api';
import { clsx } from 'clsx';

const ADMISSION_STAGES = [
  { key: 'moderation', label: 'Moderation', icon: ShieldCheckIcon },
  { key: 'sacredGuard', label: 'Sacred Guard', icon: ShieldCheckIcon },
  { key: 'costGuard', label: 'Cost Guard', icon: ShieldCheckIcon },
  { key: 'rateLimit', label: 'Rate Limit', icon: ShieldCheckIcon },
] as const;

export function ProgressDashboard() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [showAdmissionDetail, setShowAdmissionDetail] = useState<string | null>(null);
  const [showFaceLockDetail, setShowFaceLockDetail] = useState<string | null>(null);
  const [showCostGuardDialog, setShowCostGuardDialog] = useState<{ shotId: string; details: any } | null>(null);

  const { data: story, isLoading, isError, refetch } = useStory(storyId || '');

  // Real-time SSE stream
  const { isConnected, lastEvent } = useStoryStream({
    storyId: storyId || '',
    onEvent: (event) => {
      if (event.type === 'alert' && event.payload.type === 'cost_guard_pause') {
        setShowCostGuardDialog({
          shotId: event.shotId!,
          details: event.payload,
        });
      }
    },
  });

  useEffect(() => {
    if (story?.data) {
      setCurrentStory(story.data.id);
    }
  }, [story?.data?.id, setCurrentStory]);

  if (!storyId) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isError || !story?.data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ExclamationTriangleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Story Not Found</h2>
          <button onClick={() => navigate('/')} className="btn-primary mt-4">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const storyData = story.data;
  const shots = storyData.shotPlan || [];
  const status = storyData.status;

  // Find shots needing attention
  const shotsNeedingAttention = shots.filter(s =>
    s.status === 'failed' || s.status === 'timeout' || s.status === 'paused_cost'
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/stories/${storyId}/plan`)} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Generation Progress</h1>
                <p className="text-sm text-gray-500">{storyData.brief?.narrative?.substring(0, 80)}...</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge status={status} type="story" size="md" />
              <div className="flex items-center gap-2 text-sm">
                <span className={clsx('w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-gray-400')} />
                <span>{isConnected ? 'Live' : 'Polling'}</span>
              </div>
              {status === 'completed' && (
                <button onClick={() => navigate(`/stories/${storyId}/delivery`)} className="btn-primary">
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                  Download
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Alerts */}
        {shotsNeedingAttention.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">{shotsNeedingAttention.length} shot(s) need attention</p>
                <p>Some shots have failed, timed out, or are paused. Click on a shot for details.</p>
              </div>
            </div>
          </div>
        )}

        {/* Progress Timeline */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-6">
          {/* Left: Timeline */}
          <div className="lg:col-span-2 space-y-6">
            <ProgressTimeline
              storyId={storyId}
              shots={shots}
              storyStatus={status}
            />
          </div>

          {/* Right: Summary & Details */}
          <div className="space-y-6">
            {/* Overall Stats */}
            <div className="card p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Overview</h3>
              <div className="space-y-3">
                <StatRow label="Total Shots" value={shots.length} />
                <StatRow
                  label="Completed"
                  value={shots.filter(s => s.status === 'completed').length}
                  color="green"
                />
                <StatRow
                  label="Generating"
                  value={shots.filter(s => ['dispatched', 'generating'].includes(s.status)).length}
                  color="purple"
                />
                <StatRow
                  label="In Admission"
                  value={shots.filter(s => ['in_admission', 'admission_passed'].includes(s.status)).length}
                  color="blue"
                />
                <StatRow
                  label="Failed"
                  value={shots.filter(s => ['failed', 'timeout'].includes(s.status)).length}
                  color="red"
                />
                {storyData.costActualUsd && (
                  <StatRow
                    label="Actual Cost"
                    value={`$${storyData.costActualUsd.toFixed(2)}`}
                    color="orange"
                  />
                )}
                {storyData.costEstimateUsd && (
                  <StatRow
                    label="Estimated Cost"
                    value={`$${storyData.costEstimateUsd.toFixed(2)}`}
                    color="gray"
                  />
                )}
              </div>
            </div>

            {/* Cost Guard Alert */}
            {showCostGuardDialog && (
              <CostGuardPauseDialog
                details={showCostGuardDialog.details}
                onClose={() => setShowCostGuardDialog(null)}
                onResolve={(action) => {
                  notify.info('Cost Guard Resolved', `Action: ${action}`);
                  setShowCostGuardDialog(null);
                  refetch();
                }}
              />
            )}

            {/* Selected Shot Detail */}
            {selectedShot && (
              <ShotDetailPanel
                shot={selectedShot}
                onClose={() => setSelectedShot(null)}
                onViewAdmission={() => setShowAdmissionDetail(selectedShot.id)}
                onViewFaceLock={() => setShowFaceLockDetail(selectedShot.id)}
              />
            )}

            {/* Admission Detail Modal */}
            {showAdmissionDetail && (
              <AdmissionDetailModal
                shotId={showAdmissionDetail}
                shot={shots.find(s => s.id === showAdmissionDetail)!}
                onClose={() => setShowAdmissionDetail(null)}
              />
            )}

            {/* Face-Lock Detail Modal */}
            {showFaceLockDetail && (
              <FaceLockDetailModal
                shotId={showFaceLockDetail}
                shot={shots.find(s => s.id === showFaceLockDetail)!}
                onClose={() => setShowFaceLockDetail(null)}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatRow({ label, value, color = 'gray' }: { label: string; value: number | string; color?: string }) {
  const colorClasses = {
    green: 'text-green-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    orange: 'text-orange-600',
    gray: 'text-gray-900',
  };

  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={clsx('font-medium', colorClasses[color as keyof typeof colorClasses])}>
        {value}
      </span>
    </div>
  );
}


function ShotDetailPanel({
  shot,
  onClose,
  onViewAdmission,
  onViewFaceLock,
}: { shot: Shot; onClose: () => void; onViewAdmission: () => void; onViewFaceLock: () => void }) {
  const faceLockResults: FaceLockResult[] | undefined = shot.faceLockResults;
  const admission: AdmissionResult | undefined = shot.admissionResult as AdmissionResult | undefined;

  function getAdmissionJSX(): React.ReactNode | null {
    if (!admission) return null;
    return (
      <AdmissionResultDisplay admission={admission} onViewAdmission={onViewAdmission} />
    );
  }

  function renderFaceLockResults(): React.ReactNode | null {
    const results: FaceLockResult[] = faceLockResults ?? [];
    if (results.length === 0) return null;
    return (
      <React.Fragment>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-gray-900">Face-Lock Verification</span>
            <button onClick={onViewFaceLock} className="btn-ghost text-xs">Details</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {results.map((fl) => (
              <FaceLockBadge key={`${fl.characterName}-${fl.model}`} result={fl} />
            ))}
          </div>
        </div>
      </React.Fragment>
    );
  }

  function renderAdmission(): React.ReactNode | null {
    const adm: AdmissionResult | undefined = shot.admissionResult as AdmissionResult | undefined;
    if (!adm) return null;
    const element: JSX.Element = (
      <div className="mb-4 p-3 bg-gray-50 rounded">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-gray-900">Admission Pipeline</span>
          <button onClick={onViewAdmission} className="btn-ghost text-xs">Details</button>
        </div>
        <AdmissionPipelineMini admission={adm} />
      </div>
    );
    return element;
  }

  return (
    <div className="card p-4 border-l-4 border-primary-500">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Shot #{shot.orderIndex + 1}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-gray-700 mb-3">{shot.visualDescription}</p>

      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
        <div><span className="text-gray-500">Status:</span> <StatusBadge status={shot.status} type="shot" size="sm" className="ml-1" /></div>
        <div><span className="text-gray-500">Duration:</span> <span className="ml-1 font-medium">{formatDuration(shot.durationSeconds)}</span></div>
        {shot.cameraMotion && <div><span className="text-gray-500">Camera:</span> <span className="ml-1 font-medium">{shot.cameraMotion}</span></div>}
        {shot.modelOverride && <div><span className="text-gray-500">Model:</span> <span className="ml-1 font-medium text-primary-600">{shot.modelOverride}</span></div>}
      </div>

      {/* Face-Lock Results */}
      {/* {renderFaceLockResults()} */}

      {/* Admission Result */}
      {getAdmissionJSX()}

      {/* Generation Progress */}
      {shot.generationProgress !== undefined && shot.generationProgress > 0 && shot.generationProgress < 100 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Generating...</span>
            <span className="font-medium">{Math.round(shot.generationProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${shot.generationProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error State */}
      {shot.status === 'failed' && shot.generationResult?.metadata?.error != null && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          <strong>Error:</strong> {String(shot.generationResult.metadata.error)}
        </div>
      )}
    </div>
  );
}

function AdmissionPipelineMini({ admission }: { admission: AdmissionResult }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      {ADMISSION_STAGES.map((stage, i) => {
        const result = admission[stage.key];
        const passed = result?.passed;
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <stage.icon className={clsx('w-4 h-4', passed ? 'text-green-500' : 'text-red-500')} />
            {i < ADMISSION_STAGES.length - 1 && <div className="w-6 h-0.5 bg-gray-300 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

function AdmissionResultDisplay({ admission, onViewAdmission }: { admission: AdmissionResult; onViewAdmission: () => void }): React.ReactElement {
  return (
    <div className="mb-4 p-3 bg-gray-50 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-900">Admission Pipeline</span>
        <button onClick={onViewAdmission} className="btn-ghost text-xs">Details</button>
      </div>
      <AdmissionPipelineMini admission={admission} />
    </div>
  );
}

function FaceLockBadge({ result }: { result: FaceLockResult }): React.ReactElement {
  const passed = result.passed;
  const score = (result.similarityScore * 100).toFixed(0);

  return (
    <span
      className={clsx(
        'px-2 py-1 rounded-full text-xs font-medium',
        passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      )}
    >
      {result.characterName}: {score}% {passed ? '✓' : '✗'}
      {result.retryCount > 0 && ` (retry ${result.retryCount})`}
      {result.autoRegenerated && ' 🔄'}
    </span>
  );
}

function AdmissionDetailModal({ shotId, shot, onClose }: { shotId: string; shot: Shot; onClose: () => void }) {
  const admission = shot.admissionResult;

  if (!admission) return null;

  return (
    <Modal isOpen={true} onClose={onClose} title="Admission Pipeline Details" size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className={clsx('px-3 py-1 rounded-full text-sm font-medium', admission.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
            {admission.passed ? 'PASSED' : 'BLOCKED'}
          </span>
        </div>

        {ADMISSION_STAGES.map((stage) => {
          const result = admission[stage.key];
          return (
            <div key={stage.key} className="p-4 rounded-lg border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <stage.icon className={clsx('w-5 h-5', result.passed ? 'text-green-500' : 'text-red-500')} />
                  <span className="font-medium">{stage.label}</span>
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', result.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                    {result.passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
              </div>
              {result.reason && <p className="text-sm text-gray-600">Reason: {result.reason}</p>}
              {result.score !== undefined && <p className="text-sm text-gray-600">Score: {result.score.toFixed(3)} / {result.threshold?.toFixed(3) || 'N/A'}</p>}
              {result.matchType && <p className="text-sm text-gray-600">Match Type: {result.matchType}</p>}
              <div className="mt-2 text-xs text-gray-500">
                {JSON.stringify(result.details || {}, null, 2)}
              </div>
            </div>
          );
        })}

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Full Details</h4>
          <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto max-h-64">
            {JSON.stringify(admission.details, null, 2)}
          </pre>
        </div>
      </div>
    </Modal>
  );
}

function FaceLockDetailModal({ shotId, shot, onClose }: { shotId: string; shot: Shot; onClose: () => void }) {
  const results = shot.faceLockResults || [];

  if (!results.length) return null;

  return (
    <Modal isOpen={true} onClose={onClose} title="Face-Lock Verification Details" size="lg">
      <div className="space-y-4">
        {results.map((result, i) => (
          <div key={i} className="p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-medium text-gray-900">{result.characterName}</h4>
                <p className="text-sm text-gray-500">Model: {result.model}</p>
              </div>
              <span className={clsx('px-3 py-1 rounded-full text-sm font-medium', result.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                {result.passed ? 'VERIFIED' : 'FAILED'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-sm text-gray-500">Similarity Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                    <div
                      className={clsx('h-full rounded-full transition-all', result.passed ? 'bg-green-500' : 'bg-red-500')}
                      style={{ width: `${result.similarityScore * 100}%` }}
                    />
                    <div
                      className="absolute top-0 h-full w-0.5 bg-black"
                      style={{ left: `${result.threshold * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm">{(result.similarityScore * 100).toFixed(1)}%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Threshold: {(result.threshold * 100).toFixed(1)}%</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Retries</p>
                <p className="text-2xl font-bold">{result.retryCount} / {result.retryCount + (result.autoRegenerated ? 1 : 0)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {result.verificationFrames?.map((frame, fi) => (
                <div key={fi} className="aspect-video bg-gray-100 rounded overflow-hidden relative">
                  {frame && <img src={frame} alt={`Verification ${fi + 1}`} className="w-full h-full object-cover" />}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1">
                    Frame {fi + 1}
                  </div>
                </div>
              ))}
              {result.referenceFrame && (
                <div className="aspect-video bg-gray-100 rounded overflow-hidden relative">
                  <img src={result.referenceFrame} alt="Reference" className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1">
                    Reference
                  </div>
                </div>
              )}
            </div>

            {result.autoRegenerated && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
                This result was from an automatic regeneration after a previous failure.
              </div>
            )}
          </div>
        ))}

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Cross-Shot Consistency</h4>
          <p className="text-sm text-gray-600">
            Character consistency is verified across all shots. Each character's face embedding is compared
            against the reference embedding to ensure visual continuity throughout the video.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function CostGuardPauseDialog({ details, onClose, onResolve }: {
  details: any;
  onClose: () => void;
  onResolve: (action: 'reduce_scope' | 'increase_budget' | 'cancel') => void;
}) {
  const [selectedOption, setSelectedOption] = useState<'reduce_scope' | 'increase_budget' | 'cancel' | null>(null);

  return (
    <Modal isOpen={true} onClose={onClose} title="Cost Guard Alert" size="lg">
      <div className="space-y-4">
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600" />
            <span className="font-medium text-yellow-800">Cost Guard Pause</span>
          </div>
          <p className="text-sm text-yellow-700">
            Shot <strong>{details.shotId?.substring(0, 8)}</strong> exceeded the cost drift threshold.
            Estimated: ${details.estimated}, Actual: ${details.actual}, Drift: {(details.driftPercentage * 100).toFixed(1)}%
          </p>
        </div>

        <p className="text-gray-600">Choose how to proceed:</p>

        <div className="space-y-3">
          {[
            { value: 'reduce_scope', label: 'Reduce Scope', desc: 'Remove or shorten shots to stay within budget', icon: ScissorsIcon },
            { value: 'increase_budget', label: 'Increase Budget', desc: 'Raise the project ceiling or user budget limit', icon: PlusCircleIcon },
            { value: 'cancel', label: 'Cancel Story', desc: 'Stop generation and refund undispatched shots', icon: XCircleIcon },
          ].map((opt) => (
            <label
              key={opt.value}
              className={clsx(
                'flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer transition',
                selectedOption === opt.value ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <input
                type="radio"
                name="cost-guard-action"
                value={opt.value}
                checked={selectedOption === opt.value}
                onChange={() => setSelectedOption(opt.value as 'reduce_scope' | 'increase_budget' | 'cancel')}
                className="w-4 h-4 text-primary-600"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">{opt.label}</p>
                <p className="text-sm text-gray-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="pt-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary" disabled={!selectedOption}>
            Cancel
          </button>
          <button
            onClick={() => selectedOption && onResolve(selectedOption)}
            className="btn-primary"
            disabled={!selectedOption}
          >
            Continue
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ScissorsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a4 4 0 11-5.657-5.657a4 4 0 117.072 1.225" />
    </svg>
  );
}

function PlusCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default ProgressDashboard;