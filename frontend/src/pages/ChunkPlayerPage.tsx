import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { useStory } from '../hooks/useStories';
import { ChunkPlayer } from '../components/ChunkPlayer';
import { ChunkGrid } from '../components/ChunkGrid';
import { useNotifications } from '../store/uiStore';
import apiClient from '../api/client';
import type { Shot } from '../types/api';

export function ChunkPlayerPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { data: story } = useStory(storyId ?? '');

  const [selectedChunk, setSelectedChunk] = useState<Shot | null>(null);

  const shots: Shot[] = story?.shotPlan ?? story?.shots ?? [];

  const completedShots = shots.filter((s) => s.status === 'completed' && s.generationResult?.videoUrl);

  const handleSelectChunk = (chunk: Shot) => {
    setSelectedChunk(chunk);
  };

  const handleRate = async (rating: number) => {
    if (!storyId || !selectedChunk) return;
    try {
      await apiClient.submitFeedback(storyId, { rating });
      notify.success('Rated', `Shot #${selectedChunk.orderIndex + 1} rated ${rating}/5`);
    } catch {
      notify.error('Error', 'Failed to save rating');
    }
  };

  if (!storyId) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 h-16">
            <button onClick={() => navigate(-1)} className="btn-ghost p-2">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Shot Chunks</h1>
              <p className="text-sm text-gray-500">
                {completedShots.length} of {shots.length} shots completed
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Selected chunk player */}
          {selectedChunk && selectedChunk.generationResult?.videoUrl && (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      Shot #{selectedChunk.orderIndex + 1}
                    </h2>
                    <p className="text-sm text-gray-500 line-clamp-1">
                      {selectedChunk.visualDescription}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedChunk(null)}
                    className="btn-ghost text-sm"
                  >
                    Close Player
                  </button>
                </div>
              </div>
              <ChunkPlayer
                src={selectedChunk.generationResult.videoUrl}
                shotId={selectedChunk.id}
                thumbnail={selectedChunk.generationResult.thumbnailUrl}
                onRate={handleRate}
              />
            </div>
          )}

          {/* Chunk Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">All Shots</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <PlayIcon className="w-4 h-4" />
                {completedShots.length} playable
              </div>
            </div>

            {shots.length > 0 ? (
              <ChunkGrid
                chunks={shots}
                onSelect={handleSelectChunk}
              />
            ) : (
              <div className="card p-12 text-center">
                <PlayIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No shots found for this story.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default ChunkPlayerPage;
