import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  ExclamationTriangleIcon,
  FilmIcon,
} from '@heroicons/react/24/outline';
import { useStory, useReviseShotPlan } from '../hooks/useStories';
import { useUIStore, useNotifications } from '../store/uiStore';
import { StatusBadge } from '../components/ShotCard';
import type { Shot, ShotPlanRevision } from '../types/api';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';

function GripHandle({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zM15 4a1 1 0 11-2 0 1 1 0 012 0zM15 10a1 1 0 11-2 0 1 1 0 012 0zM15 16a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
}

export function ShotPlanEditor() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [revisions, setRevisions] = useState<ShotPlanRevision[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [localShots, setLocalShots] = useState<Shot[]>([]);

  const { data: story, isLoading, refetch } = useStory(storyId || '');
  const revisePlan = useReviseShotPlan();

  const userId = getUserId();

  useEffect(() => {
    if (story) {
      setCurrentStory(story.id);
      if (localShots.length === 0 && story.shots) {
        setLocalShots([...story.shots]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  const handleSave = async () => {
    if (revisions.length === 0) {
      notify.info('No Changes', 'No revisions to save');
      return;
    }

    try {
      await revisePlan.mutateAsync({ storyId: storyId!, revisions });
      notify.success('Plan Updated', 'Changes saved successfully');
      setRevisions([]);
      refetch();
    } catch (err: any) {
      notify.error('Failed to Update', err.response?.data?.error || err.message);
    }
  };

  const handleAddShot = () => {
    const newOrder = localShots.length;
    const newShot: Shot = {
      id: `temp-${Date.now()}`,
      storyId: storyId!,
      orderIndex: newOrder,
      visualDescription: 'New shot description',
      durationSeconds: 10,
      status: 'planned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLocalShots([...localShots, newShot]);
    setRevisions([...revisions, { action: 'add', newOrder, shotData: newShot }]);
  };

  const handleRemoveShot = (index: number) => {
    const shotId = localShots[index].id;
    setLocalShots(localShots.filter((_, i) => i !== index).map((s, i) => ({ ...s, orderIndex: i })));
    setRevisions([...revisions, { action: 'remove', shotId }]);
  };

  const handleUpdateShot = (index: number, updates: Partial<Shot>) => {
    const shotId = localShots[index].id;
    setLocalShots(localShots.map((s, i) => i === index ? { ...s, ...updates } : s));
    setRevisions([...revisions.filter(r => r.shotId !== shotId), { action: 'edit', shotId, shotData: updates }]);
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newShots = [...localShots];
    const [removed] = newShots.splice(fromIndex, 1);
    newShots.splice(toIndex, 0, removed);
    setLocalShots(newShots.map((s, i) => ({ ...s, orderIndex: i })));

    // Update revisions for reorder
    const updatedRevisions = newShots.map((s, i) => ({ action: 'reorder' as const, shotId: s.id, newOrder: i }));
    setRevisions(prev => [...prev.filter(r => r.action !== 'reorder'), ...updatedRevisions]);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (fromIndex !== index) {
      handleReorder(fromIndex, index);
    }
    setDragOverIndex(null);
  };

  if (!storyId) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ExclamationTriangleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Story Not Found</h2>
          <button onClick={() => navigate('/')} className="btn-primary mt-4">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const storyData = story;
  const shots = localShots.length > 0 ? localShots : (storyData.shots || []);
  const status = storyData.status;
  const canEdit = ['draft', 'planning', 'awaiting_approval'].includes(status);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/stories/${storyId}/plan`)} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Shot Plan Editor</h1>
                <p className="text-sm text-gray-500">{storyData.brief?.narrative?.substring(0, 80)}...</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge status={status} type="story" size="md" />
              {canEdit && (
                <button onClick={handleSave} disabled={revisions.length === 0 || revisePlan.isPending} className="btn-primary">
                  {revisePlan.isPending ? 'Saving...' : revisions.length > 0 ? `Save Changes (${revisions.length})` : 'No Changes'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Warning Banner */}
        {revisions.length > 0 && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-yellow-800">
                <ExclamationTriangleIcon className="w-4 h-4" />
                <span>{revisions.length} unsaved change(s). Click "Save Changes" to apply.</span>
              </div>
              <button onClick={() => { setRevisions([]); setLocalShots(storyData.shotPlan || []); }} className="btn-ghost text-sm">
                Discard Changes
              </button>
            </div>
          </div>
        )}

        {/* Shot Limit Info */}
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
          <div className="max-w-7xl mx-auto text-sm text-blue-800">
            <span className="font-medium">Shot Limit:</span> Estimated max {Math.ceil((storyData.brief?.targetDurationSeconds || 30) / 10)} shots for {formatDuration(storyData.brief?.targetDurationSeconds || 30)} at ~10s/shot (per EC-011).
            {storyData.brief?.targetDurationSeconds && storyData.brief.targetDurationSeconds > 600 && (
              <span className="ml-4 text-yellow-700">Consider breaking into multiple stories for very long videos.</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {shots.length === 0 ? (
          <div className="card p-12 text-center">
            <FilmIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Shots in Plan</h3>
            <p className="text-gray-500 mb-6">Add shots to build your video story.</p>
            {canEdit && (
              <button onClick={handleAddShot} className="btn-primary">
                <PlusIcon className="w-5 h-5 mr-2" />
                Add First Shot
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {shots.map((shot, index) => (
              <EditShotCard
                key={shot.id}
                shot={shot}
                index={index}
                dragOver={dragOverIndex === index}
                canEdit={canEdit}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onUpdate={(updates) => handleUpdateShot(index, updates)}
                onRemove={() => handleRemoveShot(index)}
              />
            ))}

            {canEdit && (
              <button onClick={handleAddShot} className="btn-secondary w-full">
                <PlusIcon className="w-5 h-5 mr-2" />
                Add Shot
              </button>
            )}
          </div>
        )}

        {/* Revision Summary */}
        {revisions.length > 0 && (
          <div className="mt-8 card p-4 border-yellow-300 bg-yellow-50">
            <h3 className="font-medium text-yellow-800 mb-3">Pending Changes ({revisions.length})</h3>
            <ul className="text-sm text-yellow-700 space-y-1">
              {revisions.map((rev, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={clsx('px-2 py-0.5 rounded text-xs', rev.action === 'add' ? 'bg-green-100 text-green-700' : rev.action === 'remove' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')}>
                    {rev.action.toUpperCase()}
                  </span>
                  {rev.shotId && <span>Shot: {rev.shotId.substring(0, 8)}</span>}
                  {rev.newOrder !== undefined && <span>→ Position {rev.newOrder + 1}</span>}
                  {rev.action === 'edit' && <span>Updated: {Object.keys(rev.shotData || {}).join(', ')}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

function EditShotCard({
  shot,
  index,
  dragOver,
  canEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onUpdate,
  onRemove,
}: {
  shot: Shot;
  index: number;
  dragOver: boolean;
  canEdit: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onUpdate: (updates: Partial<Shot>) => void;
  onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState(shot.visualDescription);
  const [duration, setDuration] = useState(shot.durationSeconds);
  const [cameraMotion, setCameraMotion] = useState(shot.cameraMotion || '');
  const [modelOverride, setModelOverride] = useState(shot.modelOverride || '');

  const handleSave = () => {
    onUpdate({
      visualDescription: description,
      durationSeconds: duration,
      cameraMotion,
      modelOverride,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDescription(shot.visualDescription);
    setDuration(shot.durationSeconds);
    setCameraMotion(shot.cameraMotion || '');
    setModelOverride(shot.modelOverride || '');
    setIsEditing(false);
  };

  return (
    <div
      className={clsx(
        'card transition-all duration-200',
        dragOver ? 'ring-2 ring-primary-500 bg-primary-50' : '',
        isEditing ? 'ring-2 ring-primary-500' : ''
      )}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Drag Handle */}
          {canEdit && (
            <div className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing">
              <GripHandle className="w-5 h-5" />
            </div>
          )}

          {/* Shot Content */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="label">Visual Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="input"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Duration (s)</label>
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
                      placeholder="e.g., slow pan left"
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
                <div className="flex gap-2">
                  <button onClick={handleSave} className="btn-primary text-sm">Save</button>
                  <button onClick={handleCancel} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-8 text-center text-gray-500 font-medium text-lg">#{index + 1}</span>
                  <h3 className="font-semibold text-gray-900">{shot.visualDescription}</h3>
                  <StatusBadge status={shot.status} type="shot" />
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-2">
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
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            {canEdit && (
              <>
                {isEditing ? null : (
                  <button onClick={() => setIsEditing(true)} className="btn-secondary text-sm">
                    <PencilIcon className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                )}
                <button onClick={onRemove} className="btn-ghost text-sm text-red-600">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}
            {!canEdit && (
              <span className="text-xs text-gray-400 text-center py-2">
                Plan locked<br />(status: {shot.status})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default ShotPlanEditor;