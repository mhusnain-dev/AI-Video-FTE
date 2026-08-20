import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useStory, useRegenerateShot } from '../hooks/useStories';
import { useUIStore, useNotifications } from '../store/uiStore';
import { StatusBadge } from '../components/ShotCard';
import { AlertDialog } from '../components/Modal';
import { ChatEntryButton, ProactiveToast } from '../components';
import type { Shot, FaceLockResult } from '../types/api';
import { clsx } from 'clsx';
import { getUserId } from '../utils/userId';

export function FaceLockReview() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { setCurrentStory } = useUIStore();

  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [verificationExhausted, setVerificationExhausted] = useState<{ shotId: string; characterName: string } | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const { data: story, isLoading, refetch } = useStory(storyId || '');
  const regenerateShot = useRegenerateShot();

  if (story) {
    setCurrentStory(story.id);
  }

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
  const shots = storyData.shotPlan || [];
  const characterNames: string[] = shots.flatMap((s: Shot) => (s.characterNames || []));
  const characters: string[] = [...new Set(characterNames)];

  // Get all Face-Lock results grouped by character
  const faceLockResults = characters.map(charName => ({
    characterName: charName,
    results: shots.flatMap((shot: Shot) =>
      (shot.faceLockResults || [])
        .filter((fl: FaceLockResult) => fl.characterName === charName)
        .map((fl: FaceLockResult) => ({ ...fl, shotId: shot.id, shotOrder: shot.orderIndex, shotDescription: shot.visualDescription }))
    ),
  }));

  const handleRetry = async (shotId: string, characterName: string) => {
    setRegenerating(shotId);
    try {
      await regenerateShot.mutateAsync({ shotId, userId: getUserId(), options: { faceLockRetry: true, characterName } });
      notify.success('Regeneration Started', `Face-Lock retry for ${characterName} in shot ${shotId.substring(0, 8)}`);
      refetch();
    } catch (err: any) {
      notify.error('Failed to Retry', err.response?.data?.error || err.message);
    } finally {
      setRegenerating(null);
    }
  };

  const handleExhaustedAction = (action: 'proceed' | 'alt_model' | 'cancel') => {
    if (verificationExhausted) {
      notify.info('Action Selected', `Verification exhausted: ${action}`);
      setVerificationExhausted(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Proactive Toast */}
      <ProactiveToast
        trigger={verificationExhausted ? 'facelock_fail' : null}
        storyId={storyId}
        details={verificationExhausted ? { shotId: verificationExhausted.shotId, characterName: verificationExhausted.characterName } : null}
        onDismiss={() => {}}
      />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/stories/${storyId}/progress`)} className="btn-ghost p-2">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div className="flex-1">
                <h1 className="text-lg font-semibold text-gray-900">Face-Lock Review</h1>
                <p className="text-sm text-gray-500">Character consistency verification across all shots</p>
              </div>
              <ChatEntryButton storyId={storyId} />
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge status={storyData.status} type="story" size="md" />
            </div>
          </div>
        </div>

        {/* Character Tabs */}
        {characters.length > 0 && (
          <div className="border-t border-gray-200 overflow-x-auto">
            <nav className="flex" aria-label="Character tabs">
              {characters.map((charName) => (
                <button
                  key={charName}
                  onClick={() => setSelectedCharacter(charName)}
                  className={clsx(
                    'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                    selectedCharacter === charName
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  )}
                >
                  {charName}
                  <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                    {faceLockResults.find(f => f.characterName === charName)?.results.length || 0} shots
                  </span>
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {characters.length === 0 ? (
          <div className="card p-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Characters in Story</h3>
            <p className="text-gray-500 mb-6">
              Add character references in the Character Manager to enable Face-Lock verification.
            </p>
            <button onClick={() => navigate(`/stories/${storyId}/characters`)} className="btn-primary">
              Manage Characters
            </button>
          </div>
        ) : selectedCharacter ? (
          <CharacterFaceLockView
            characterName={selectedCharacter}
            results={faceLockResults.find(f => f.characterName === selectedCharacter)?.results || []}
            onRetry={handleRetry}
            onExhausted={setVerificationExhausted}
            regenerating={regenerating}
          />
        ) : (
          <div className="card p-8 text-center text-gray-500">
            Select a character from the tabs above to view Face-Lock verification results.
          </div>
        )}

        {/* Cross-Shot Consistency Gallery */}
        {selectedCharacter && (
          <CrossShotConsistencyGallery
            characterName={selectedCharacter}
            shots={shots}
          />
        )}

        {/* Verification Exhausted Dialog */}
        {verificationExhausted && (
          <AlertDialog
            isOpen={true}
            onClose={() => setVerificationExhausted(null)}
            title="Verification Exhausted"
            message={`Face-Lock verification for "${verificationExhausted.characterName}" in shot ${verificationExhausted.shotId.substring(0, 8)} has failed after maximum retries. How would you like to proceed?`}
            type="warning"
            actionLabel="Proceed Without Verification"
            onAction={() => handleExhaustedAction('proceed')}
          />
        )}
      </main>
    </div>
  );
}

function CharacterFaceLockView({
  characterName,
  results,
  onRetry,
  onExhausted,
  regenerating,
}: {
  characterName: string;
  results: (FaceLockResult & { shotId: string; shotOrder: number; shotDescription: string })[];
  onRetry: (shotId: string, characterName: string) => void;
  onExhausted: (data: { shotId: string; characterName: string }) => void;
  regenerating: string | null;
}) {
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{characterName}</h2>
            <p className="text-sm text-gray-500">
              {passedCount} of {totalCount} shots passed • Max retries per shot: 2
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-900">
              {(passedCount / Math.max(totalCount, 1) * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-gray-500">Pass Rate</div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', passedCount === totalCount ? 'bg-green-500' : 'bg-yellow-500')}
            style={{ width: `${(passedCount / Math.max(totalCount, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Shots Grid */}
      <div className="space-y-4">
        {results.map((result) => (
          <FaceLockShotCard
            key={`${result.shotId}-${result.model}`}
            result={result}
            onRetry={onRetry}
            onExhausted={onExhausted}
            isRegenerating={regenerating === result.shotId}
          />
        ))}

        {results.length === 0 && (
          <div className="card p-8 text-center text-gray-500">
            No Face-Lock results yet for this character. Generation may still be in progress.
          </div>
        )}
      </div>
    </div>
  );
}

function FaceLockShotCard({
  result,
  onRetry,
  onExhausted,
  isRegenerating,
}: {
  result: FaceLockResult & { shotId: string; shotOrder: number; shotDescription: string };
  onRetry: (shotId: string, characterName: string) => void;
  onExhausted: (data: { shotId: string; characterName: string }) => void;
  isRegenerating: boolean;
}) {
  const passed = result.passed;
  const score = (result.similarityScore * 100).toFixed(1);
  const threshold = (result.threshold * 100).toFixed(1);
  const isExhausted = result.retryCount >= 2 && !passed;

  return (
    <div className={clsx('card p-4', passed ? 'border-green-200 bg-green-50' : isExhausted ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-medium">
              #{result.shotOrder + 1}
            </span>
            <div>
              <h3 className="font-medium text-gray-900">{result.shotDescription}</h3>
              <p className="text-sm text-gray-500">Model: {result.model}</p>
            </div>
            <StatusBadge
              status={passed ? 'completed' : isExhausted ? 'failed' : 'regenerating'}
              type="shot"
              size="md"
            />
          </div>

          {/* Similarity Meter */}
          <div className="mb-3">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Similarity Score</span>
              <span className="font-medium">{score}% / {threshold}% threshold</span>
            </div>
            <div className="relative w-full bg-gray-200 rounded-full h-3">
              <div
                className={clsx('h-full rounded-full transition-all duration-500', passed ? 'bg-green-500' : 'bg-red-500')}
                style={{ width: `${Math.min(result.similarityScore * 100, 100)}%` }}
              />
              {/* Threshold marker */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-black/30"
                style={{ left: `${Math.min(result.threshold * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Retry Info */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
            <span>Retries: {result.retryCount} / 2</span>
            {result.autoRegenerated && <span className="text-yellow-600">Auto-regenerated</span>}
          </div>

          {/* Verification Frames */}
          {(result.verificationFrames?.length || result.referenceFrame) && (
            <details className="group">
              <summary className="text-sm text-primary-600 hover:text-primary-700 cursor-pointer flex items-center gap-1">
                <span>Verification Frames</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </summary>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                {result.referenceFrame && (
                  <div className="relative aspect-video bg-gray-100 rounded overflow-hidden">
                    <img src={result.referenceFrame} alt="Reference" className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">Reference</div>
                  </div>
                )}
                {result.verificationFrames?.map((frame, fi) => (
                  <div key={fi} className="relative aspect-video bg-gray-100 rounded overflow-hidden">
                    <img src={frame} alt={`Frame ${fi + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">Frame {fi + 1}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {isExhausted ? (
            <button
              onClick={() => onExhausted({ shotId: result.shotId, characterName: result.characterName })}
              className="btn-danger text-sm"
            >
              <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
              Verification Exhausted
            </button>
          ) : !passed ? (
            <button
              onClick={() => onRetry(result.shotId, result.characterName)}
              disabled={isRegenerating}
              className="btn-primary text-sm"
            >
              {isRegenerating ? (
                <> <svg className="animate-spin w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Retrying... </>
              ) : (
                <>
                  <ArrowPathIcon className="w-4 h-4 mr-1" />
                  Retry Verification
                </>
              )}
            </button>
          ) : (
            <span className="text-green-600 text-sm font-medium">
              <CheckCircleIcon className="w-4 h-4 inline mr-1" />
              Verified
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CrossShotConsistencyGallery({
  characterName,
  shots,
}: {
  characterName: string;
  shots: Shot[];
}) {
  const characterShots = shots.filter(s => s.characterNames?.includes(characterName));

  if (characterShots.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Cross-Shot Consistency Gallery</h2>
      <p className="text-sm text-gray-500 mb-4">
        Reference face compared against all generated frames for "{characterName}" across {characterShots.length} shots.
      </p>

      <div className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Shot #</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Description</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Reference</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Generated Frames</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {characterShots.map((shot) => {
                const flResult = shot.faceLockResults?.find(f => f.characterName === characterName);
                return (
                  <tr key={shot.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">#{shot.orderIndex + 1}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{shot.visualDescription}</td>
                    <td className="px-4 py-3">
                      {flResult?.referenceFrame ? (
                        <img src={flResult.referenceFrame} alt="Reference" className="w-16 h-10 object-cover rounded" />
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {flResult?.verificationFrames?.slice(0, 3).map((frame, fi) => (
                          <img key={fi} src={frame} alt={`Frame ${fi + 1}`} className="w-16 h-10 object-cover rounded" />
                        ))}
                        {(flResult?.verificationFrames?.length ?? 0) > 3 && (
                          <div className="w-16 h-10 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500">
                            +{((flResult?.verificationFrames?.length ?? 0) - 3)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {flResult ? (
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div
                              className={clsx('h-full rounded-full', flResult.passed ? 'bg-green-500' : 'bg-red-500')}
                              style={{ width: `${flResult.similarityScore * 100}%` }}
                            />
                          </div>
                          <span className={clsx('text-sm font-medium', flResult.passed ? 'text-green-600' : 'text-red-600')}>
                            {(flResult.similarityScore * 100).toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default FaceLockReview;