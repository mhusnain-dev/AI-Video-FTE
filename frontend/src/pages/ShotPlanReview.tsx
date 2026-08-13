import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  PencilIcon,
  EyeIcon,
  PlayIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useStory, usePresentShotPlan, useApproveShotPlan, useReviseShotPlan } from '../hooks/useStories';
import { useUIStore, useNotifications } from '../store/uiStore';
import { ShotCard } from '../components/ShotCard';
import { StatusBadge } from '../components/ShotCard';
import { Modal, ConfirmDialog } from '../components/Modal';
import type { Story, Shot, ShotPlanRevision } from '../types/api';
import { clsx } from 'clsx';

export function ShotPlanReview() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [revisions, setRevisions] = useState<ShotPlanRevision[]>([]);
  const [editingShot, setEditingShot] = useState<Shot | null>(null);

  const { data: story, isLoading, isError, refetch } = useStory(storyId || '');
  const presentPlan = usePresentShotPlan();
  const approvePlan = useApproveShotPlan();
  const revisePlan = useReviseShotPlan();

  const userId = localStorage.getItem('user_id') || 'demo-user';

  // Set current story in UI store
  if (story?.data) {
    setCurrentStory(story.data.id);
  }

  const handlePresent = async () => {
    try {
      await presentPlan.mutateAsync(storyId!);
      notify.success('Plan Presented', 'Shot plan is now awaiting approval');
      refetch();
    } catch (err: any) {
      notify.error('Failed to Present', err.response?.data?.error || err.message);
    }
  };

  const handleApprove = async () => {
    try {
      await approvePlan.mutateAsync({ storyId: storyId!, userId });
      notify.success('Plan Approved', 'Generation will begin shortly');
      refetch();
      setShowApproveConfirm(false);
    } catch (err: any) {
      notify.error('Failed to Approve', err.response?.data?.error || err.message);
    }
  };

  const handleRequestChanges = () => {
    setShowRequestChanges(true);
  };

  const handleSaveRevisions = async () => {
    try {
      await revisePlan.mutateAsync({ storyId: storyId!, revisions });
      notify.success('Plan Updated', 'Changes saved successfully');
      refetch();
      setShowRequestChanges(false);
      setRevisions([]);
    } catch (err: any) {
      notify.error('Failed to Update', err.response?.data?.error || err.message);
    }
  };

  const handleEditShot = (shot: Shot) => {
    setEditingShot(shot);
  };

  const handleSaveShotEdit = (shotId: string, updates: Partial<Shot>) => {
    setRevisions(prev => [
      ...prev.filter(r => r.shotId !== shotId),
      { action: 'edit', shotId, shotData: updates },
    ]);
    setEditingShot(null);
  };

  const handleAddShot = () => {
    const newOrder = (story.data?.shotPlan?.length || 0);
    setRevisions(prev => [
      ...prev,
      {
        action: 'add',
        newOrder,
        shotData: {
          visualDescription: 'New shot description',
          durationSeconds: 10,
          orderIndex: newOrder,
        },
      },
    ]);
  };

  const handleRemoveShot = (shotId: string) => {
    setRevisions(prev => [...prev, { action: 'remove', shotId }]);
  };

  const handleReorderShots = (shotIds: string[]) => {
    shotIds.forEach((id, index) => {
      setRevisions(prev => [
        ...prev.filter(r => r.shotId !== id),
        { action: 'reorder', shotId: id, newOrder: index },
      ]);
    });
  };

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

  const canPresent = status === 'draft' || status === 'planning';
  const canApprove = status === 'awaiting_approval';
  const canEdit = ['draft', 'planning', 'awaiting_approval'].includes(status);
  const isGenerating = ['in_progress', 'generating', 'merging'].includes(status);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/')} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Shot Plan Review</h1>
                <p className="text-sm text-gray-500">{storyData.brief?.narrative?.substring(0, 80)}...</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge status={status} type="story" size="md" />
              {canPresent && (
                <button onClick={handlePresent} className="btn-primary">
                  Present for Approval
                </button>
              )}
              {canApprove && (
                <button onClick={() => setShowApproveConfirm(true)} className="btn-primary">
                  <CheckCircleIcon className="w-5 h-5 mr-2" />
                  Approve Plan
                </button>
              )}
              {isGenerating && (
                <button onClick={() => navigate(`/stories/${storyId}/progress`)} className="btn-primary">
                  <PlayIcon className="w-5 h-5 mr-2" />
                  View Progress
                </button>
              )}
              {status === 'completed' && (
                <button onClick={() => navigate(`/stories/${storyId}/delivery`)} className="btn-primary">
                  Download Video
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Story Info Bar */}
        <div className="card p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Target Duration:</span>
              <span className="ml-2 font-medium">{formatDuration(storyData.brief?.targetDurationSeconds || 0)}</span>
            </div>
            <div>
              <span className="text-gray-500">Aspect Ratio:</span>
              <span className="ml-2 font-medium">{storyData.brief?.aspectRatio || '16:9'}</span>
            </div>
            <div>
              <span className="text-gray-500">Resolution:</span>
              <span className="ml-2 font-medium">{storyData.brief?.resolution || '1080p'}</span>
            </div>
            <div>
              <span className="text-gray-500">Shots:</span>
              <span className="ml-2 font-medium">{shots.length}</span>
            </div>
            {storyData.costEstimateUsd && (
              <div className="md:col-span-4">
                <span className="text-gray-500">Estimated Cost:</span>
                <span className="ml-2 font-medium">${storyData.costEstimateUsd.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Shot Plan */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Shot Plan ({shots.length} shots)</h2>
            {canEdit && (
              <button onClick={handleAddShot} className="btn-secondary text-sm">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Shot
              </button>
            )}
          </div>

          {shots.length === 0 ? (
            <div className="card p-12 text-center">
              <ClockIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No shots in plan yet.</p>
              {canEdit && (
                <button onClick={handleAddShot} className="btn-primary mt-4">
                  Add First Shot
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {shots.map((shot, index) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  onEdit={canEdit ? handleEditShot : undefined}
                  onViewDetails={() => navigate(`/stories/${storyId}/shots/${shot.id}`)}
                  onRegenerate={() => {}}
                  showActions={canEdit}
                />
              ))}
            </div>
          )}

          {/* Revision Preview */}
          {revisions.length > 0 && (
            <div className="card p-4 border-yellow-300 bg-yellow-50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-yellow-800">Pending Changes ({revisions.length})</h3>
                <div className="flex gap-2">
                  <button onClick={handleSaveRevisions} className="btn-primary text-sm">
                    Save Changes
                  </button>
                  <button onClick={() => setRevisions([])} className="btn-secondary text-sm">
                    Discard
                  </button>
                </div>
              </div>
              <ul className="text-sm text-yellow-700 space-y-1">
                {revisions.map((rev, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-yellow-200 rounded text-xs">{rev.action}</span>
                    {rev.shotId && <span>Shot: {rev.shotId.substring(0, 8)}</span>}
                    {rev.newOrder !== undefined && <span>→ Position {rev.newOrder + 1}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Editing Shot Modal */}
        <Modal
          isOpen={!!editingShot}
          onClose={() => setEditingShot(null)}
          title="Edit Shot"
          size="lg"
        >
          {editingShot && (
            <ShotEditForm
              shot={editingShot}
              onSave={handleSaveShotEdit}
              onCancel={() => setEditingShot(null)}
            />
          )}
        </Modal>

        {/* Approve Confirmation */}
        <ConfirmDialog
          isOpen={showApproveConfirm}
          onClose={() => setShowApproveConfirm(false)}
          onConfirm={handleApprove}
          title="Approve Shot Plan"
          message="This will start the generation process for all shots. Once approved, the plan cannot be modified without creating a new revision. Are you sure you want to proceed?"
          confirmLabel="Approve & Start Generation"
          variant="primary"
          isLoading={approvePlan.isPending}
        />

        {/* Request Changes Modal */}
        <Modal
          isOpen={showRequestChanges}
          onClose={() => setShowRequestChanges(false)}
          title="Request Changes"
          size="lg"
        >
          <div className="space-y-4">
            <p className="text-gray-600">
              Describe the changes you'd like to make to the shot plan. You can edit individual shots,
              add new ones, remove shots, or reorder them.
            </p>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {shots.map((shot, index) => (
                <div key={shot.id} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 text-center font-medium">#{index + 1}</span>
                    <span className="font-medium">{shot.visualDescription}</span>
                    <span className="ml-auto text-sm text-gray-500">{formatDuration(shot.durationSeconds)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditShot(shot)}
                      className="btn-secondary text-sm"
                    >
                      <PencilIcon className="w-4 h-4 mr-1" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleRemoveShot(shot.id)}
                      className="btn-ghost text-sm text-red-600"
                    >
                      <XCircleIcon className="w-4 h-4 mr-1" />
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button onClick={() => setShowRequestChanges(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSaveRevisions} className="btn-primary" disabled={revisions.length === 0}>
                Save Changes ({revisions.length})
              </button>
            </div>
          </div>
        </Modal>
      </main>
    </div>
  );
}

function ShotEditForm({ shot, onSave, onCancel }: { shot: Shot; onSave: (id: string, updates: Partial<Shot>) => void; onCancel: () => void }) {
  const [description, setDescription] = useState(shot.visualDescription);
  const [duration, setDuration] = useState(shot.durationSeconds);
  const [cameraMotion, setCameraMotion] = useState(shot.cameraMotion || '');
  const [modelOverride, setModelOverride] = useState(shot.modelOverride || '');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(shot.id, { visualDescription: description, durationSeconds: duration, cameraMotion, modelOverride }); }}>
      <div className="space-y-4">
        <div>
          <label className="label">Visual Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
              min="1"
              max="300"
              className="input"
            />
          </div>
          <div>
            <label className="label">Camera Motion</label>
            <input
              type="text"
              value={cameraMotion}
              onChange={(e) => setCameraMotion(e.target.value)}
              placeholder="e.g., slow pan left, zoom in, static"
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="label">Model Override (Optional)</label>
          <input
            type="text"
            value={modelOverride}
            onChange={(e) => setModelOverride(e.target.value)}
            placeholder="veo3-low, veo3-high, runway-gen3, luma-ray2"
            className="input"
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" className="btn-primary">Save Changes</button>
      </div>
    </form>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default ShotPlanReview;