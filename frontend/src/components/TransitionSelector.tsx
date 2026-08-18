import { useState } from 'react';
import {
  ArrowsRightLeftIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';

interface ShotPair {
  id: string;
  fromShotIndex: number;
  toShotIndex: number;
  currentTransition?: string;
}

interface TransitionSelectorProps {
  shotPairs: ShotPair[];
  onTransitionChange: (pairId: string, transition: string) => void;
  onApplyToAll: (transition: string) => void;
}

const TRANSITIONS = [
  { value: 'crossfade', label: 'Cross-Fade', description: 'Smooth dissolve between shots' },
  { value: 'fade', label: 'Fade', description: 'Fade through black' },
  { value: 'fadeblack', label: 'Fade Black', description: 'Fade to/from black' },
  { value: 'fadewhite', label: 'Fade White', description: 'Fade to/from white' },
  { value: 'slideleft', label: 'Slide Left', description: 'New shot slides in from right' },
  { value: 'slideright', label: 'Slide Right', description: 'New shot slides in from left' },
  { value: 'slideup', label: 'Slide Up', description: 'New shot slides up from bottom' },
  { value: 'slidedown', label: 'Slide Down', description: 'New shot slides down from top' },
  { value: 'zoomin', label: 'Zoom In', description: 'Zoom into new shot' },
  { value: 'circleopen', label: 'Circle Open', description: 'Circle reveal transition' },
  { value: 'circleclose', label: 'Circle Close', description: 'Circle close transition' },
  { value: 'wipeleft', label: 'Wipe Left', description: 'Wipe from right to left' },
  { value: 'wiperight', label: 'Wipe Right', description: 'Wipe from left to right' },
  { value: 'wipeup', label: 'Wipe Up', description: 'Wipe from bottom to top' },
  { value: 'wipedown', label: 'Wipe Down', description: 'Wipe from top to bottom' },
  { value: 'dissolve', label: 'Dissolve', description: 'Pixel dissolve effect' },
  { value: 'smoothleft', label: 'Smooth Left', description: 'Smooth slide from right' },
  { value: 'smoothright', label: 'Smooth Right', description: 'Smooth slide from left' },
];

export function TransitionSelector({ shotPairs, onTransitionChange, onApplyToAll }: TransitionSelectorProps) {
  const [globalTransition, setGlobalTransition] = useState('crossfade');

  return (
    <div className="space-y-4">
      {/* Apply to All */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <SparklesIcon className="w-5 h-5 text-primary-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Quick Apply</p>
            <p className="text-xs text-gray-500">Set the same transition between all shot pairs</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={globalTransition}
              onChange={(e) => setGlobalTransition(e.target.value)}
              className="input w-48"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={() => onApplyToAll(globalTransition)}
              className="btn-primary text-sm whitespace-nowrap"
            >
              Apply to All
            </button>
          </div>
        </div>
      </div>

      {/* Per-pair selectors */}
      {shotPairs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Individual Transitions</h3>
          {shotPairs.map((pair) => (
            <PairTransitionRow
              key={pair.id}
              pair={pair}
              onChange={(transition) => onTransitionChange(pair.id, transition)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PairTransitionRow({ pair, onChange }: { pair: ShotPair; onChange: (transition: string) => void }) {
  const [selected, setSelected] = useState(pair.currentTransition ?? 'crossfade');

  const handleChange = (value: string) => {
    setSelected(value);
    onChange(value);
  };

  return (
    <div className="card p-3">
      <div className="flex items-center gap-3">
        <ArrowsRightLeftIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-sm text-gray-700 whitespace-nowrap">
          Shot #{pair.fromShotIndex + 1} → #{pair.toShotIndex + 1}
        </span>
        <div className="flex-1" />
        <select
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
          className={clsx(
            'input w-44 text-sm',
            selected !== 'crossfade' && 'border-primary-300 bg-primary-50'
          )}
        >
          {TRANSITIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default TransitionSelector;
