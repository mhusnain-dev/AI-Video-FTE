import {
  PlayIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import type { Shot } from '../types/api';

type ChunkStatus = Shot['status'];

interface ChunkGridProps {
  chunks: Shot[];
  onSelect?: (chunk: Shot) => void;
}

const STATUS_CONFIG: Record<ChunkStatus, { label: string; color: string; bg: string }> = {
  planned: { label: 'Planned', color: 'text-gray-600', bg: 'bg-gray-100' },
  awaiting_approval: { label: 'Awaiting', color: 'text-blue-600', bg: 'bg-blue-100' },
  approved: { label: 'Approved', color: 'text-indigo-600', bg: 'bg-indigo-100' },
  in_admission: { label: 'Admission', color: 'text-yellow-600', bg: 'bg-yellow-100' },
  admission_passed: { label: 'Passed', color: 'text-green-600', bg: 'bg-green-100' },
  dispatched: { label: 'Dispatched', color: 'text-blue-600', bg: 'bg-blue-100' },
  generating: { label: 'Generating', color: 'text-amber-600', bg: 'bg-amber-100' },
  completed: { label: 'Done', color: 'text-green-600', bg: 'bg-green-100' },
  failed: { label: 'Failed', color: 'text-red-600', bg: 'bg-red-100' },
  timeout: { label: 'Timeout', color: 'text-orange-600', bg: 'bg-orange-100' },
  regenerating: { label: 'Regenerating', color: 'text-purple-600', bg: 'bg-purple-100' },
};

function StatusBadge({ status }: { status: ChunkStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.planned;
  return (
    <span className={clsx('badge', config.bg, config.color)}>
      {status === 'generating' && <ClockIcon className="w-3 h-3 mr-1 animate-spin" />}
      {status === 'completed' && <CheckCircleIcon className="w-3 h-3 mr-1" />}
      {status === 'failed' && <ExclamationCircleIcon className="w-3 h-3 mr-1" />}
      {config.label}
    </span>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function ChunkGrid({ chunks, onSelect }: ChunkGridProps) {
  if (chunks.length === 0) {
    return (
      <div className="card p-12 text-center">
        <PlayIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">No shot chunks available.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {chunks.map((chunk) => {
        const thumbnail = chunk.generationResult?.thumbnailUrl;
        const hasVideo = chunk.status === 'completed' && chunk.generationResult?.videoUrl;

        return (
          <button
            key={chunk.id}
            onClick={() => onSelect?.(chunk)}
            className={clsx(
              'card overflow-hidden text-left transition-all hover:shadow-md',
              hasVideo && 'cursor-pointer hover:border-primary-300'
            )}
          >
            {/* Thumbnail */}
            <div className="relative aspect-video bg-gray-100">
              {thumbnail ? (
                <img src={thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <PlayIcon className="w-10 h-10 text-gray-300" />
                </div>
              )}

              {/* Play overlay */}
              {hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center">
                    <PlayIcon className="w-5 h-5 text-gray-900 ml-0.5" />
                  </div>
                </div>
              )}

              {/* Duration */}
              <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white font-medium">
                {formatDuration(chunk.durationSeconds)}
              </div>

              {/* Order index */}
              <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white font-medium">
                #{chunk.orderIndex + 1}
              </div>
            </div>

            {/* Info */}
            <div className="p-3">
              <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-2">
                {chunk.visualDescription}
              </p>
              <StatusBadge status={chunk.status} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default ChunkGrid;
