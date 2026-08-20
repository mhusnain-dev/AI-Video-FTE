import { clsx } from 'clsx';
import { useStoryStream } from '../hooks/useStoryStream';
import { useNotifications } from '../store/uiStore';
import type { Shot, ShotStatus, StoryStatus } from '../types/api';

interface ProgressTimelineProps {
  storyId: string;
  shots: Shot[];
  storyStatus: StoryStatus;
  className?: string;
}

const STATUS_ORDER: (ShotStatus | StoryStatus)[] = [
  'planned',
  'awaiting_approval',
  'approved',
  'in_admission',
  'admission_passed',
  'dispatched',
  'generating',
  'completed',
  'failed',
  'timeout',
  'regenerating',
];

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  awaiting_approval: 'Awaiting Approval',
  approved: 'Approved',
  in_admission: 'In Admission',
  admission_passed: 'Admission Passed',
  dispatched: 'Dispatched',
  generating: 'Generating',
  completed: 'Completed',
  failed: 'Failed',
  timeout: 'Timeout',
  regenerating: 'Regenerating',
};

export function ProgressTimeline({
  storyId,
  shots,
  storyStatus,
  className = '',
}: ProgressTimelineProps) {
  const { notify } = useNotifications();
  const [activeShotId, setActiveShotId] = useSet(new Set());

  // Use SSE for real-time updates
  const { isConnected } = useStoryStream({
    storyId,
    onEvent: (event) => {
      if (event.type === 'shot_status' && event.shotId) {
        // Highlight the active shot
        if (['dispatched', 'generating'].includes(event.payload.status as string)) {
          setActiveShotId((prev) => new Set([...prev, event.shotId!]));
        } else if (event.payload.status === 'completed') {
          setActiveShotId((prev) => {
            const next = new Set(prev);
            next.delete(event.shotId!);
            return next;
          });
        }
      }

      // Show notifications for important events
      if (event.type === 'alert') {
        notify.warning(event.payload.title as string, event.payload.message as string);
      } else if (event.type === 'error') {
        notify.error('Error', event.payload.message as string);
      } else if (event.type === 'delivery_ready') {
        notify.success('Video Ready', 'Your video has been merged and is ready for download!');
      }
    },
  });

  // Get status index for progress calculation
  const getStatusIndex = (status: string) => STATUS_ORDER.indexOf(status as any);

  // Calculate overall progress
  const completedShots = shots.filter((s) => s.status === 'completed').length;
  const totalShots = shots.length;
  const overallProgress = totalShots > 0 ? (completedShots / totalShots) * 100 : 0;

  // Get current phase
  const getCurrentPhase = () => {
    if (storyStatus === 'draft' || storyStatus === 'planning') return 'Planning';
    if (storyStatus === 'awaiting_approval') return 'Awaiting Approval';
    if (storyStatus === 'approved') return 'Admission';
    if (storyStatus === 'in_progress' || storyStatus === 'generating') return 'Generation';
    if (storyStatus === 'merging') return 'Merging';
    if (storyStatus === 'completed') return 'Complete';
    if (storyStatus === 'failed') return 'Failed';
    return 'In Progress';
  };

  return (
    <div className={clsx('space-y-6', className)}>
      {/* Overall Progress */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{getCurrentPhase()}</h3>
            <p className="text-sm text-gray-500">
              {completedShots} of {totalShots} shots completed
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary-600">{Math.round(overallProgress)}%</div>
            <div className="text-sm text-gray-500">
              {isConnected ? '🟢 Live' : '🔴 Polling'}
            </div>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className="bg-primary-600 h-full rounded-full transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Shot Timeline */}
      <div className="space-y-4">
        {shots.map((shot, index) => {
          const status = shot.status || 'planned';
          const statusIndex = getStatusIndex(status);
          const isCurrent = activeShotId.has(shot.id);
          const isCompleted = statusIndex >= getStatusIndex('completed');
          const isFailed = status === 'failed' || status === 'timeout';
          const isActive = isCurrent || (isCompleted && !isFailed);

          return (
            <div
              key={shot.id}
              className={clsx(
                'relative flex items-start gap-4 transition-all duration-300',
                isCurrent ? 'scale-[1.02] z-10' : ''
              )}
            >
              {/* Vertical line */}
              <div className="flex flex-col items-center pt-2">
                <div
                  className={clsx(
                    'w-3 h-3 rounded-full border-3 transition-all duration-300',
                    isFailed ? 'bg-red-500 border-red-500' :
                    isCompleted ? 'bg-green-500 border-green-500' :
                    isActive ? 'bg-primary-500 border-primary-500 animate-pulse' :
                    'bg-gray-200 border-gray-300'
                  )}
                />
                {index < shots.length - 1 && (
                  <div
                    className={clsx(
                        'w-0.5 flex-1 mt-1 transition-colors duration-300',
                        isCompleted ? 'bg-green-500' : 'bg-gray-200'
                    )}
                    style={{ height: 'calc(100% - 24px)' }}
                  />
                )}
              </div>

              {/* Shot Card */}
              <div
                className={clsx(
                  'flex-1 card p-4 relative',
                  isCurrent && 'ring-2 ring-primary-500 shadow-lg',
                  isFailed && 'ring-1 ring-red-300 bg-red-50',
                  isCompleted && 'bg-green-50'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="w-8 text-center text-gray-500 font-medium">#{shot.orderIndex + 1}</span>
                      <h4 className="font-medium text-gray-900 truncate">{shot.visualDescription}</h4>
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          getStatusStyle(status)
                        )}
                      >
                        {STATUS_LABELS[status] || status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-gray-600 mb-2">
                      <span>Duration: {formatDuration(shot.durationSeconds)}</span>
                      {shot.cameraMotion && <span>Camera: {shot.cameraMotion}</span>}
                      {shot.modelOverride && <span className="text-primary-600">Model: {shot.modelOverride}</span>}
                    </div>

                    {shot.characterNames?.length && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {shot.characterNames.map((name) => (
                          <span key={name} className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded-full">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Admission Pipeline Mini-View */}
                    {shot.admissionResult && (
                      <AdmissionPipelineMini admission={shot.admissionResult} />
                    )}

                    {/* Face-Lock Results */}
                    {shot.faceLockResults?.length && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Face-Lock Verification:</div>
                        <div className="flex flex-wrap gap-2">
                          {shot.faceLockResults.map((fl) => (
                            <FaceLockBadge key={`${fl.characterName}-${fl.model}`} result={fl} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generation Progress */}
                    {shot.generationProgress !== undefined && shot.generationProgress > 0 && shot.generationProgress < 100 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span>Generating...</span>
                          <span>{Math.round(shot.generationProgress)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-primary-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${shot.generationProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Thumbnail/Preview Placeholder */}
                  <div className="w-24 h-16 shrink-0 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative">
                    {shot.generationResult?.thumbnailUrl ? (
                      <img
                        src={shot.generationResult.thumbnailUrl}
                        alt={`Shot ${shot.orderIndex + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center text-gray-400">
                        <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs block mt-1">Preview</span>
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute inset-0 bg-primary-500/20 flex items-center justify-center">
                        <span className="text-primary-600 font-medium text-sm">Processing...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            { label: 'Pending', color: 'bg-gray-300' },
            { label: 'Active', color: 'bg-primary-500 animate-pulse' },
            { label: 'Completed', color: 'bg-green-500' },
            { label: 'Failed', color: 'bg-red-500' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className={`${item.color} w-3 h-3 rounded-full`} />
              <span className="text-gray-600">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper components
function getStatusStyle(status: string): string {
  const styles: Record<string, string> = {
    planned: 'bg-gray-100 text-gray-700',
    awaiting_approval: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    in_admission: 'bg-blue-100 text-blue-700',
    admission_passed: 'bg-teal-100 text-teal-700',
    dispatched: 'bg-indigo-100 text-indigo-700',
    generating: 'bg-purple-100 text-purple-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    timeout: 'bg-orange-100 text-orange-700',
    regenerating: 'bg-violet-100 text-violet-700',
  };
  return styles[status] || 'bg-gray-100 text-gray-700';
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function AdmissionPipelineMini({ admission }: { admission: any }) {
  const stages = [
    { key: 'moderation', label: 'Moderation' },
    { key: 'sacredGuard', label: 'Sacred Guard' },
    { key: 'costGuard', label: 'Cost Guard' },
    { key: 'rateLimit', label: 'Rate Limit' },
  ];

  return (
    <div className="mt-2 pt-2 border-t border-gray-200">
      <div className="text-xs text-gray-500 mb-1">Admission Pipeline:</div>
      <div className="flex items-center gap-1">
        {stages.map((stage, i) => {
          const result = admission[stage.key];
          const passed = result?.passed;
          return (
            <div key={stage.key} className="flex items-center gap-1">
              <div
                className={clsx(
                  'w-2 h-2 rounded-full',
                  passed ? 'bg-green-500' : 'bg-red-500'
                )}
              />
              {i < stages.length - 1 && <div className="w-4 h-0.5 bg-gray-300" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FaceLockBadge({ result }: { result: any }) {
  const passed = result.passed;
  const score = (result.similarityScore * 100).toFixed(0);

  return (
    <span
      className={clsx(
        'px-2 py-0.5 rounded-full text-xs font-medium',
        passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      )}
    >
      {result.characterName}: {score}% {passed ? '✓' : '✗'}
      {result.retryCount > 0 && ` (retry ${result.retryCount})`}
    </span>
  );
}

// useSet hook for Set state
function useSet<T>(initial: Set<T> = new Set()): [Set<T>, (updater: Set<T> | ((prev: Set<T>) => Set<T>)) => void] {
  const [set, setSet] = useState<Set<T>>(initial);
  const updateSet = (updater: Set<T> | ((prev: Set<T>) => Set<T>)) => {
    setSet((prev) => typeof updater === 'function' ? updater(prev) : updater);
  };
  return [set, updateSet];
}

import { useState } from 'react';

export default ProgressTimeline;