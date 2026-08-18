import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useCharacters, useUploadCharacter, useDeleteCharacter, useStory } from '../hooks/useStories';
import { useUIStore, useNotifications } from '../store/uiStore';
import { CharacterUploader } from '../components/CharacterUploader';
import { Modal, ConfirmDialog } from '../components/Modal';
import { StatusBadge } from '../components/ShotCard';
import type { CharacterReference } from '../types/api';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';

export function CharacterManager() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingCharacter, setDeletingCharacter] = useState<string | null>(null);

  const { data: story } = useStory(storyId || '');
  const { data: charactersResponse, isLoading, refetch } = useCharacters(storyId || '');
  const uploadCharacter = useUploadCharacter();
  const deleteCharacter = useDeleteCharacter();

  const userId = getUserId();
  const characters = charactersResponse?.data?.characters || [];

  if (story) {
    setCurrentStory(story.id);
  }

  const handleUpload = (character: CharacterReference) => {
    notify.success('Character Uploaded', `${character.name} has been added and passed Sacred Guard check.`);
    setShowUploadModal(false);
    refetch();
  };

  const handleDelete = async (characterId: string) => {
    setDeletingCharacter(characterId);
    try {
      await deleteCharacter.mutateAsync({ storyId: storyId!, characterId });
      notify.success('Character Deleted', 'Character reference has been removed.');
      refetch();
    } catch (err: any) {
      notify.error('Failed to Delete', err.response?.data?.error || err.message);
    } finally {
      setDeletingCharacter(null);
    }
  };

  const handleViewVerification = (character: CharacterReference) => {
    navigate(`/stories/${storyId}/characters/${character.id}/verification`);
  };

  if (!storyId) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/stories/${storyId}/plan`)} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Character References</h1>
                <p className="text-sm text-gray-500">
                  {story?.brief?.narrative?.substring(0, 60)}...
                </p>
              </div>
            </div>

            <button onClick={() => setShowUploadModal(true)} className="btn-primary">
              <PlusIcon className="w-5 h-5 mr-2" />
              Add Character
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Info Banner */}
        <div className="card p-4 mb-6 border-blue-200 bg-blue-50">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Face-Lock Character Consistency</p>
              <p>
                Upload character reference images to ensure consistent face generation across all shots.
                Each image passes through <strong>Sacred Guard</strong> verification to prevent unauthorized likenesses.
                Face embeddings are encrypted with <strong>Vault Transit</strong> (AES-256-GCM).
              </p>
            </div>
          </div>
        </div>

        {/* Characters List */}
        <div className="card">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4" />
              <p className="text-gray-500">Loading characters...</p>
            </div>
          ) : characters.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Characters Yet</h3>
              <p className="text-gray-500 mb-6">
                Add character references to enable Face-Lock consistency across shots.
              </p>
              <button onClick={() => setShowUploadModal(true)} className="btn-primary">
                <PlusIcon className="w-5 h-5 mr-2" />
                Upload First Character
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {characters.map((character: CharacterReference) => (
                <div key={character.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-4">
                    {/* Avatar Preview */}
                    <div className="relative w-16 h-16 shrink-0">
                      {character.imageBase64 ? (
                        <img
                          src={`data:image/png;base64,${character.imageBase64}`}
                          alt={character.name}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-100 rounded-lg flex items-center justify-center">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                        {character.name.charAt(0).toUpperCase()}
                      </div>
                    </div>

                    {/* Character Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-gray-900 truncate">{character.name}</h3>
                        <StatusBadge
                          status={character.sacredGuardPassed ? 'approved' : 'failed'}
                          type="shot"
                          size="sm"
                        />
                        <span className={clsx(
                            'px-2 py-0.5 rounded-full text-xs font-medium',
                            character.faceDetected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          )}>
                          {character.faceDetected ? 'Face Detected ✓' : 'No Face ✗'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          Encrypted ✓
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-gray-500">
                        <span>ID: {character.id.substring(0, 8)}...</span>
                        {character.sacredGuardScore !== undefined && (
                          <span>Sacred Guard: {(character.sacredGuardScore * 100).toFixed(1)}%</span>
                        )}
                        <span>Added: {formatDate(character.createdAt)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleViewVerification(character)}
                        className="btn-secondary text-sm"
                        title="View Face-Lock Verification"
                      >
                        <PlayIcon className="w-4 h-4 mr-1" />
                        Verify
                      </button>
                      <button
                        onClick={() => handleDelete(character.id)}
                        disabled={deletingCharacter === character.id}
                        className="btn-ghost text-sm text-red-600 hover:text-red-700"
                        title="Delete Character"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sacred Guard Info */}
        <div className="mt-6 card p-4 bg-gray-50">
          <h3 className="font-medium text-gray-900 mb-2">Sacred Guard Protection</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span>Checks against protected figures database at upload time</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span>Visual similarity threshold: 0.75-0.80 (per-model configurable)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span>Exact match, fuzzy match, and visual similarity detection</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span>Dual-approve workflow available for borderline cases</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
              <span>All face embeddings encrypted with Vault Transit (AES-256-GCM)</span>
            </li>
          </ul>
        </div>
      </main>

      {/* Upload Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title="Upload Character Reference"
        size="lg"
      >
        <CharacterUploader
          storyId={storyId!}
          userId={userId}
          onUpload={handleUpload}
          existingCharacters={characters}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingCharacter}
        onClose={() => setDeletingCharacter(null)}
        onConfirm={() => deletingCharacter && handleDelete(deletingCharacter)}
        title="Delete Character"
        message="Are you sure you want to delete this character reference? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteCharacter.isPending}
      />
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default CharacterManager;