import { useEffect, useState } from 'react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '../store/chatStore';

interface ProactiveToastProps {
  trigger: 'facelock_fail' | 'cost_drift' | 'sacred_guard' | 'generation_timeout' | null;
  storyId: string;
  details: {
    shotId?: string;
    characterName?: string;
    score?: number;
    threshold?: number;
    driftPercentage?: number;
    message?: string;
  } | null;
  onDismiss: () => void;
}

export function ProactiveToast({ trigger, storyId, details, onDismiss }: ProactiveToastProps) {
  const { open } = useChatStore();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (trigger && details) {
      setShow(true);
      const timer = setTimeout(() => setShow(false), 10000);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [trigger, details]);

  if (!show || !details) return null;

  const getToastContent = () => {
    switch (trigger) {
      case 'facelock_fail':
        return {
          icon: SparklesIcon,
          title: 'Face-Lock Issue Detected',
          message: `Shot ${details.shotId?.substring(0, 8)}: ${details.characterName} score ${(details.score || 0).toFixed(2)} below threshold ${(details.threshold || 0).toFixed(2)}`,
          actionLabel: 'Fix with FTE',
        };
      case 'cost_drift':
        return {
          icon: SparklesIcon,
          title: 'Cost Drift Alert',
          message: `Drift ${(details.driftPercentage || 0).toFixed(1)}% exceeds threshold`,
          actionLabel: 'Optimize with FTE',
        };
      case 'sacred_guard':
        return {
          icon: SparklesIcon,
          title: 'Sacred Guard Blocked',
          message: details.message || 'Content blocked by Sacred Guard',
          actionLabel: 'Review with FTE',
        };
      case 'generation_timeout':
        return {
          icon: SparklesIcon,
          title: 'Generation Timeout',
          message: `Shot ${details.shotId?.substring(0, 8)} timed out`,
          actionLabel: 'Retry with FTE',
        };
      default:
        return null;
    }
  };

  const content = getToastContent();
  if (!content) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-sm p-4 flex items-start gap-3">
        <div className="flex-shrink-0 p-2 bg-purple-100 rounded-lg">
          <content.icon className="w-5 h-5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900">{content.title}</p>
          <p className="text-sm text-gray-600 mt-1">{content.message}</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                open(storyId);
                onDismiss();
              }}
              className="btn-primary text-sm flex-1"
            >
              <SparklesIcon className="w-4 h-4 mr-1" />
              {content.actionLabel}
            </button>
            <button
              onClick={onDismiss}
              className="btn-ghost text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}