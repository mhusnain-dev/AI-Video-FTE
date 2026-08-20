import { useState } from 'react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { Modal, ConfirmDialog } from './Modal';
import { useNotifications } from '../store/uiStore';
import { useMergeStory } from '../hooks/useStories';
import { apiClient } from '../api/client';
import type { Story } from '../types/api';

interface MergeApprovalDialogProps {
  story: Story;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function MergeApprovalDialog({ story, isOpen, onClose, onComplete }: MergeApprovalDialogProps) {
  const { notify } = useNotifications();
  const mergeStory = useMergeStory();
  const [showConfirm, setShowConfirm] = useState(false);

  const completedShots = story.shots?.filter(s => s.status === 'completed').length || 0;
  const totalShots = story.shots?.length || 0;
  const failedShots = story.shots?.filter(s => s.status === 'failed').length || 0;

  const handleApproveMerge = async () => {
    try {
      // First transition to merging state
      await apiClient.approveMerge(story.id);
      // Then trigger the actual merge
      await mergeStory.mutateAsync({ storyId: story.id });
      notify.success('Merge Started', 'Your video is being assembled. This may take a few minutes.');
      setShowConfirm(false);
      onComplete();
    } catch (err: any) {
      notify.error('Merge Failed', err.response?.data?.error || err.message);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Ready to Merge" size="md">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircleIcon className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">All Shots Generated</h3>
              <p className="text-sm text-gray-600 mt-1">
                {completedShots} of {totalShots} shots completed successfully.
                {failedShots > 0 && (
                  <span className="text-yellow-600 ml-1">({failedShots} failed)</span>
                )}
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">Merge will:</p>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  <li>Assemble shots with transitions</li>
                  <li>Add ambient audio track</li>
                  <li>Generate the final video file</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={onClose} className="btn-secondary">
              Review Shots
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              className="btn-primary flex items-center gap-2"
              disabled={mergeStory.isPending}
            >
              <PlayIcon className="w-4 h-4" />
              Approve & Merge
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleApproveMerge}
        title="Confirm Merge"
        message="This will start the video merge process. The final video will be available for download once complete. Continue?"
        confirmLabel="Start Merge"
        variant="primary"
        isLoading={mergeStory.isPending}
      />
    </>
  );
}
