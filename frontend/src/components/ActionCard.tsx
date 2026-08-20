import { CheckCircleIcon, XMarkIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import type { ChatAction } from '../store/chatStore';

interface ActionCardProps {
  action: ChatAction;
  onApply: () => void;
  onDismiss: () => void;
}

export function ActionCard({ action, onApply, onDismiss }: ActionCardProps) {
  const fieldLabels: Record<string, string> = {
    visualDescription: 'Visual Description',
    cameraMotion: 'Camera Motion',
    durationSeconds: 'Duration',
    transition: 'Transition',
  };

  return (
    <div className="border-2 border-yellow-300 bg-yellow-50 rounded-xl p-4 animate-slide-in">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-yellow-200 flex items-center justify-center">
            <ArrowRightIcon className="w-5 h-5 text-yellow-700" />
          </div>
          <div>
            <h4 className="font-semibold text-yellow-800">Proposed Change</h4>
            <p className="text-sm text-yellow-700">
              Shot <code className="px-1 bg-yellow-200 rounded">{action.shotId.substring(0, 8)}</code> • {fieldLabels[action.field] || action.field}
            </p>
          </div>
        </div>
        <span className="px-2 py-0.5 text-xs bg-yellow-200 text-yellow-800 rounded-full">
          {action.status === 'proposed' ? 'Pending' : action.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white p-3 rounded-lg border border-yellow-200">
          <p className="text-xs text-gray-500 mb-1">Before</p>
          <pre className="text-sm text-gray-900 whitespace-pre-wrap max-h-24 overflow-auto">{action.before || '(empty)'}</pre>
        </div>
        <div className="bg-white p-3 rounded-lg border border-yellow-200">
          <p className="text-xs text-gray-500 mb-1">After</p>
          <pre className="text-sm text-yellow-800 font-medium whitespace-pre-wrap max-h-24 overflow-auto">{action.after}</pre>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onDismiss}
          className="btn-secondary text-sm"
        >
          <XMarkIcon className="w-4 h-4 mr-1" />
          Dismiss
        </button>
        <button
          onClick={onApply}
          className="btn-primary text-sm flex items-center gap-1"
        >
          <CheckCircleIcon className="w-4 h-4" />
          Apply Change
        </button>
      </div>
    </div>
  );
}