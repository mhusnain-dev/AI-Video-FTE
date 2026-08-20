import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useStory } from '../hooks/useStories';
import apiClient from '../api/client';
import { useNotifications } from '../store/uiStore';
import { ChatEntryButton } from '../components/ChatEntryButton';

export function PromptReview() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const { data: story } = useStory(storyId ?? '');

  const [prompt, setPrompt] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sanitized, setSanitized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);

  useEffect(() => {
    if (!storyId) return;

    const fetchPrompt = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await apiClient.getPromptReview(storyId);
        setPrompt(response.data.prompt);
        setWarnings(response.data.warnings);
        setSanitized(response.data.sanitized);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load prompt';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrompt();
  }, [storyId]);

  const handleApprove = async () => {
    if (!storyId) return;
    setIsDispatching(true);
    try {
      await apiClient.approvePrompt(storyId, prompt);
      notify.success('Dispatched', 'Story has been sent for generation.');
      navigate(`/stories/${storyId}/progress`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to dispatch';
      notify.error('Dispatch Failed', message);
    } finally {
      setIsDispatching(false);
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
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-gray-900">Prompt Review</h1>
              <p className="text-sm text-gray-500">
                {story?.brief?.narrative?.substring(0, 60)}...
              </p>
            </div>
            <ChatEntryButton storyId={storyId} />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading && (
          <div className="card p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4" />
            <p className="text-gray-500">Loading compiled prompt...</p>
          </div>
        )}

        {error && (
          <div className="card p-8 text-center">
            <ExclamationTriangleIcon className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">Error Loading Prompt</p>
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-6">
            {/* Sanitization Warnings */}
            {warnings.length > 0 && (
              <div className="card p-4 border-yellow-200 bg-yellow-50">
                <div className="flex items-start gap-3">
                  <ShieldCheckIcon className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-yellow-800 mb-1">Sanitization Warnings</h3>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-1.5 w-1 h-1 bg-yellow-500 rounded-full flex-shrink-0" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {sanitized && warnings.length === 0 && (
              <div className="card p-4 border-green-200 bg-green-50">
                <div className="flex items-center gap-3">
                  <CheckCircleIcon className="w-5 h-5 text-green-600" />
                  <p className="text-sm text-green-700 font-medium">Prompt sanitized — no issues detected</p>
                </div>
              </div>
            )}

            {/* Editable Prompt */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Compiled Prompt</h2>
                <span className="text-xs text-gray-400">{prompt.length} characters</span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="input font-mono text-sm min-h-[400px] resize-y leading-relaxed"
                spellCheck={false}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button onClick={() => navigate(-1)} className="btn-secondary">
                Back to Story
              </button>
              <button
                onClick={handleApprove}
                disabled={isDispatching || !prompt.trim()}
                className="btn-primary flex items-center gap-2"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                {isDispatching ? 'Dispatching...' : 'Approve & Dispatch'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default PromptReview;
