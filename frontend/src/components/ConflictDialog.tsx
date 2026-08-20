import { clsx } from 'clsx';
import { XMarkIcon, CheckCircleIcon, PlusCircleIcon } from '@heroicons/react/24/outline';

interface ConflictDialogProps {
  previous: string;
  current: string;
  field: string;
  onResolve: (choice: 'previous' | 'current' | 'combine') => void;
  onCancel: () => void;
}

export function ConflictDialog({ previous, current, field, onResolve, onCancel }: ConflictDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Conflicting Instruction</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="font-medium text-yellow-800">Conflicting instruction for {field}</span>
          </div>
          <p className="text-sm text-yellow-700">You previously said one thing, now you're saying another. Which should FTE follow?</p>
        </div>

        <div className="space-y-3 mb-4">
          <label className={clsx(
            'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition',
            'border-yellow-300 bg-yellow-50'
          )}>
            <input
              type="radio"
              name="conflict-resolution"
              value="previous"
              onChange={() => onResolve('previous')}
              className="w-4 h-4 text-yellow-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Keep Previous</p>
              <p className="text-sm text-gray-600">"{previous}"</p>
            </div>
            <CheckCircleIcon className="w-5 h-5 text-yellow-600" />
          </label>

          <label className={clsx(
            'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition',
            'border-blue-300 bg-blue-50'
          )}>
            <input
              type="radio"
              name="conflict-resolution"
              value="current"
              onChange={() => onResolve('current')}
              className="w-4 h-4 text-blue-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Use Current</p>
              <p className="text-sm text-gray-600">"{current}"</p>
            </div>
            <CheckCircleIcon className="w-5 h-5 text-blue-600" />
          </label>

          <label className={clsx(
            'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition',
            'border-green-300 bg-green-50'
          )}>
            <input
              type="radio"
              name="conflict-resolution"
              value="combine"
              onChange={() => onResolve('combine')}
              className="w-4 h-4 text-green-600"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">Combine Both</p>
              <p className="text-sm text-gray-600">Merge: "{previous}" + "{current}"</p>
            </div>
            <PlusCircleIcon className="w-5 h-5 text-green-600" />
          </label>
        </div>

        <div className="flex gap-3 pt-4 border-t">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}