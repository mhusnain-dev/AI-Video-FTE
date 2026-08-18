import { clsx } from 'clsx';
import type { Shot, ShotStatus, StoryStatus } from '../types/api';

const SHOT_STATUS_STYLES: Record<ShotStatus, string> = {
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

const STORY_STATUS_STYLES: Record<StoryStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  planning: 'bg-blue-100 text-blue-700',
  awaiting_approval: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  generating: 'bg-purple-100 text-purple-700',
  pending_merge: 'bg-amber-100 text-amber-700',
  merging: 'bg-pink-100 text-pink-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
  paused_cost: 'bg-orange-100 text-orange-700',
  paused_rate_limit: 'bg-yellow-100 text-yellow-700',
  paused_sacred_guard: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status, type = 'shot', size = 'md', className = '' }: {
  status: ShotStatus | StoryStatus;
  type?: 'shot' | 'story';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const styles = type === 'story' ? STORY_STATUS_STYLES : SHOT_STATUS_STYLES;
  const baseStyle = styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-700';

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1 text-sm',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        baseStyle,
        sizeClasses[size],
        className
      )}
    >
      {status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
    </span>
  );
}

interface ShotCardProps {
  shot: Shot;
  onEdit?: (shot: Shot) => void;
  onRegenerate?: (shot: Shot) => void;
  onViewDetails?: (shot: Shot) => void;
  showActions?: boolean;
  compact?: boolean;
}

export function ShotCard({
  shot,
  onEdit,
  onRegenerate,
  onViewDetails,
  showActions = true,
  compact = false,
}: ShotCardProps) {
  const status = shot.status || 'planned';
  const duration = shot.durationSeconds || 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
        <span className="w-8 text-center text-gray-500 font-medium">#{shot.orderIndex + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{shot.visualDescription}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500">{durationStr}</span>
            {shot.cameraMotion && <span className="text-xs text-gray-400">{shot.cameraMotion}</span>}
            <StatusBadge status={status} type="shot" size="sm" />
          </div>
        </div>
        {shot.modelOverride && (
          <span className="px-2 py-0.5 text-xs bg-primary-50 text-primary-700 rounded">{shot.modelOverride}</span>
        )}
      </div>
    );
  }

  return (
    <div className="card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="w-8 text-center text-gray-500 font-medium text-lg">#{shot.orderIndex + 1}</span>
            <h3 className="text-lg font-semibold text-gray-900 truncate">{shot.visualDescription}</h3>
            <StatusBadge status={status} type="shot" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
            <div>
              <span className="text-gray-500">Duration:</span>
              <span className="ml-1 font-medium">{durationStr}</span>
            </div>
            {shot.cameraMotion && (
              <div>
                <span className="text-gray-500">Camera:</span>
                <span className="ml-1 font-medium text-gray-700">{shot.cameraMotion}</span>
              </div>
            )}
            {shot.modelOverride && (
              <div>
                <span className="text-gray-500">Model:</span>
                <span className="ml-1 font-medium text-primary-600">{shot.modelOverride}</span>
              </div>
            )}
            {shot.estimatedCostUsd && (
              <div>
                <span className="text-gray-500">Est. Cost:</span>
                <span className="ml-1 font-medium">${shot.estimatedCostUsd.toFixed(4)}</span>
              </div>
            )}
          </div>

          {shot.characterNames?.length && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {shot.characterNames.map((name) => (
                <span key={name} className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded-full">
                  {name}
                </span>
              ))}
            </div>
          )}

          {(shot.keyObjects?.length || shot.keyActions?.length) && (
            <div className="flex flex-wrap gap-1.5 mb-3 text-sm text-gray-600">
              {shot.keyObjects?.map((obj) => (
                <span key={obj} className="px-2 py-0.5 bg-gray-50 rounded">{obj}</span>
              ))}
              {shot.keyActions?.map((action) => (
                <span key={action} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{action}</span>
              ))}
            </div>
          )}

          {shot.compiledPrompt && (
            <details className="group">
              <summary className="text-sm text-primary-600 hover:text-primary-700 cursor-pointer flex items-center gap-1">
                <span>Compiled Prompt</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </summary>
              <pre className="mt-2 p-3 bg-gray-50 rounded text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-32">
                {shot.compiledPrompt}
              </pre>
            </details>
          )}

          {shot.transition && (
            <div className="mt-3 p-2 bg-gray-50 rounded flex items-center gap-2 text-sm">
              <span className="text-gray-500">Transition:</span>
              <span className="font-medium capitalize">{shot.transition.type}</span>
              <span className="text-gray-400">{shot.transition.durationSeconds}s</span>
            </div>
          )}
        </div>

        {showActions && (
          <div className="flex flex-col gap-2 shrink-0">
            {onViewDetails && (
              <button
                onClick={() => onViewDetails(shot)}
                className="btn-secondary text-sm"
              >
                Details
              </button>
            )}
            {onEdit && status === 'planned' && (
              <button
                onClick={() => onEdit(shot)}
                className="btn-secondary text-sm"
              >
                Edit
              </button>
            )}
            {onRegenerate && ['completed', 'failed'].includes(status) && (
              <button
                onClick={() => onRegenerate(shot)}
                className="btn-primary text-sm"
              >
                Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ShotCard;