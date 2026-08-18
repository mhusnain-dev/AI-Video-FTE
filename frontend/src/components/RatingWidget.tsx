import { useState, useCallback } from 'react';
import {
  StarIcon,
  FlagIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { clsx } from 'clsx';
import apiClient from '../api/client';
import { useNotifications } from '../store/uiStore';

interface RatingWidgetProps {
  storyId: string;
  existingRating?: number;
  existingComment?: string;
  compact?: boolean;
  onSubmitted?: () => void;
}

const FLAG_REASONS = [
  { value: 'low_quality', label: 'Low Quality' },
  { value: 'wrong_content', label: 'Wrong Content' },
  { value: 'offensive', label: 'Offensive' },
  { value: 'other', label: 'Other' },
] as const;

export function RatingWidget({ storyId, existingRating, existingComment, compact = false, onSubmitted }: RatingWidgetProps) {
  const { notify } = useNotifications();
  const [rating, setRating] = useState(existingRating ?? 0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState(existingComment ?? '');
  const [showFlag, setShowFlag] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(!!existingRating);

  const handleRate = useCallback((value: number) => {
    setRating(value);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (rating === 0 && !flagReason) return;

    setIsSubmitting(true);
    try {
      await apiClient.submitFeedback(storyId, {
        rating,
        comment: comment || undefined,
        flagReason: flagReason || undefined,
      });
      setSubmitted(true);
      notify.success('Feedback Submitted', 'Thank you for your feedback.');
      onSubmitted?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to submit feedback';
      notify.error('Submission Failed', message);
    } finally {
      setIsSubmitting(false);
    }
  }, [rating, comment, flagReason, storyId, notify, onSubmitted]);

  if (submitted && !showFlag) {
    return (
      <div className={clsx('card p-4', compact && 'p-3')}>
        <p className="text-sm text-gray-500">Feedback submitted. Thank you!</p>
      </div>
    );
  }

  return (
    <div className={clsx('card p-4', compact && 'p-3')}>
      {/* Star Rating */}
      <div className="mb-3">
        <p className="text-sm font-medium text-gray-700 mb-2">Rate this video</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRate(star)}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(0)}
              className={clsx(
                'transition-colors',
                (hoveredStar || rating) >= star ? 'text-yellow-400' : 'text-gray-300'
              )}
              aria-label={`Rate ${star} stars`}
            >
              {(hoveredStar || rating) >= star ? (
                <StarIconSolid className="w-7 h-7" />
              ) : (
                <StarIcon className="w-7 h-7" />
              )}
            </button>
          ))}
          {rating > 0 && (
            <span className="ml-2 text-sm text-gray-500">{rating}/5</span>
          )}
        </div>
      </div>

      {/* Comment */}
      {!compact && (
        <div className="mb-3">
          <label className="label">Comment (optional)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input min-h-[80px] resize-y"
            placeholder="Tell us what you think..."
          />
        </div>
      )}

      {/* Flag section */}
      <div className="mb-3">
        <button
          onClick={() => setShowFlag(!showFlag)}
          className={clsx(
            'text-sm font-medium flex items-center gap-1.5 transition-colors',
            showFlag ? 'text-red-600' : 'text-gray-500 hover:text-red-600'
          )}
        >
          <FlagIcon className="w-4 h-4" />
          Flag Content
        </button>

        {showFlag && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-red-800">Flag this content</p>
              <button onClick={() => { setShowFlag(false); setFlagReason(''); }} className="text-red-400 hover:text-red-600">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <select
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              className="input text-sm"
            >
              <option value="">Select a reason...</option>
              {FLAG_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || (rating === 0 && !flagReason)}
          className="btn-primary text-sm"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}

export default RatingWidget;
