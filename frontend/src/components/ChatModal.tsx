import { useEffect, useRef, useState, useCallback } from 'react';
import { XMarkIcon, PaperAirplaneIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { MessageList } from './MessageList';
import { MentionAutocomplete } from './MentionAutocomplete';
import { ConflictDialog } from './ConflictDialog';
import { useChatStore } from '../store/chatStore';
import { useNotifications } from '../store/uiStore';
import apiClient, { ChatContext } from '../api/client';
import { clsx } from 'clsx';

interface ChatModalProps {
  readOnly?: boolean;
}

export function ChatModal({ readOnly = false }: ChatModalProps) {
  const { close } = useChatStore();
  const { notify } = useNotifications();
  const {
    messages,
    streaming,
    streamBuffer,
    pendingAction,
    temperature,
    selectedModel,
    readOnly: storeReadOnly,
    addMessage,
    updateLastMessage,
    appendStreamToken,
    commitStream,
    setPendingAction,
    applyAction,
    dismissAction,
    setSelectedModel,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentions, setMentions] = useState<{ shots?: string[]; characters?: string[] }>({});
  const [conflict, setConflict] = useState<{ previous: string; current: string; field: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const effectiveReadOnly = readOnly || storeReadOnly;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleClose = () => {
    close();
  };

  const handleSend = useCallback(async () => {
    const { storyId } = useChatStore.getState();
    if (!storyId || (!input.trim() && !streamBuffer)) return;
    if (streaming) return;

    const userMessage = input.trim();
    setInput('');
    setShowMentions(false);

    // Add user message
    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    // Prepare context
    const context: ChatContext = {
      temperature,
      model: selectedModel,
      mentions: Object.keys(mentions).length > 0 ? mentions : undefined,
    };

    // Add placeholder assistant message
    const assistantMsgId = crypto.randomUUID();
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
    });

    try {
      const generator = apiClient.sendChatMessage(storyId, userMessage, context);
      for await (const chunk of generator) {
        if (chunk.token) {
          appendStreamToken(chunk.token);
          updateLastMessage(streamBuffer + chunk.token);
        }
        if (chunk.action) {
          setPendingAction(chunk.action);
        }
        if (chunk.complete) {
          commitStream();
          if (chunk.action) {
            setPendingAction({ ...chunk.action, status: 'proposed' });
          }
          if (chunk.summary) {
            // Summary handled by backend
          }
        }
        if (chunk.error) {
          commitStream();
          notify.error('Chat Error', chunk.error);
        }
      }
    } catch (error) {
      commitStream();
      console.error('Chat error:', error);
      notify.error('Chat Error', error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setMentions({});
    }
  }, [input, streaming, streamBuffer, temperature, mentions, addMessage, updateLastMessage, appendStreamToken, commitStream, setPendingAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === '@' && !showMentions) {
      setShowMentions(true);
      setMentionQuery('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Check for @mention
    const lastAt = value.lastIndexOf('@');
    if (lastAt !== -1 && lastAt === value.length - 1) {
      setShowMentions(true);
      setMentionQuery('');
    } else if (lastAt !== -1) {
      const query = value.substring(lastAt + 1);
      if (!query.includes(' ') && !query.includes('@')) {
        setShowMentions(true);
        setMentionQuery(query);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const handleMentionSelect = (mention: { type: 'shot' | 'character'; id: string; label: string }) => {
    const newMentions = { ...mentions };
    if (mention.type === 'shot') {
      newMentions.shots = [...(newMentions.shots || []), mention.id];
    } else {
      newMentions.characters = [...(newMentions.characters || []), mention.id];
    }
    setMentions(newMentions);
    setShowMentions(false);
    // Replace @query with the mention label
    const lastAt = input.lastIndexOf('@');
    if (lastAt !== -1) {
      const newInput = input.substring(0, lastAt) + `@${mention.label} `;
      setInput(newInput);
    }
  };

  const handleApplyAction = async () => {
    if (!pendingAction) return;
    const { storyId } = useChatStore.getState();
    if (!storyId) return;

    try {
      // Call existing PATCH /api/stories/:id/plan endpoint
      await apiClient.reviseShotPlan(storyId, [{
        action: 'edit',
        shotId: pendingAction.shotId,
        shotData: { [pendingAction.field]: pendingAction.after },
      }]);
      applyAction(pendingAction.shotId);
      setPendingAction({ ...pendingAction, status: 'applied' });
    } catch (error) {
      console.error('Failed to apply action:', error);
    }
  };

  const handleDismissAction = () => {
    dismissAction();
  };

  const handleConflictResolve = (choice: 'previous' | 'current' | 'combine') => {
    if (!conflict) return;
    // Send resolution back to chat
    let resolution = '';
    if (choice === 'previous') resolution = `Keep previous: ${conflict.previous}`;
    else if (choice === 'current') resolution = `Use new: ${conflict.current}`;
    else resolution = `Combine both: ${conflict.previous} + ${conflict.current}`;

    setInput(resolution);
    handleSend();
    setConflict(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 sm:inset-0"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={clsx(
          'relative w-full max-w-2xl sm:max-w-3xl h-full sm:h-[80vh] bg-white rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col overflow-hidden',
          effectiveReadOnly ? 'opacity-75' : ''
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Chat with FTE"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Chat with FTE</h2>
              <p className="text-xs text-gray-500">
                {selectedModel === 'nvidia' ? 'Nemotron 3 Ultra 550B' : 'Gemini 2.0 Flash'} • Temp: {temperature}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {effectiveReadOnly && (
              <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">Read-only</span>
            )}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as 'gemini' | 'nvidia')}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
              title="Select LLM provider"
            >
              <option value="gemini">Gemini 2.0 Flash</option>
              <option value="nvidia">Nemotron 3 Ultra 550B</option>
            </select>
<button
          onClick={handleClose}
          className="btn-ghost p-2"
          aria-label="Close chat"
        >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <MessageList
            messages={messages}
            streamBuffer={streamBuffer}
            streaming={streaming}
            pendingAction={pendingAction}
            readOnly={effectiveReadOnly}
            onApplyAction={handleApplyAction}
            onDismissAction={handleDismissAction}
          />
          <div ref={messagesEndRef} />
        </div>

        {/* Conflict Dialog */}
        {conflict && (
          <ConflictDialog
            previous={conflict.previous}
            current={conflict.current}
            field={conflict.field}
            onResolve={handleConflictResolve}
            onCancel={() => setConflict(null)}
          />
        )}

        {/* Input Area */}
        <div className="border-t border-gray-200 p-4 bg-white">
          <MentionAutocomplete
            show={showMentions}
            query={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setShowMentions(false)}
          />
          <div className="flex items-end gap-2 mt-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={effectiveReadOnly ? 'Read-only mode' : 'Ask FTE anything... (Ctrl+Enter to send)'}
              disabled={effectiveReadOnly || streaming}
              className={clsx(
                'flex-1 min-h-[60px] max-h-[200px] px-4 py-2.5 text-sm border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500',
                effectiveReadOnly ? 'bg-gray-50' : ''
              )}
              rows={1}
              style={{ overflow: 'hidden' }}
            />
            <button
              onClick={handleSend}
              disabled={effectiveReadOnly || streaming || !input.trim() && !streamBuffer}
              className={clsx(
                'btn-primary p-2 h-10 flex-shrink-0',
                streaming ? 'opacity-50 cursor-not-allowed' : ''
              )}
              aria-label={streaming ? 'Streaming...' : 'Send message'}
            >
              {streaming ? (
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
              ) : (
                <PaperAirplaneIcon className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-center">
            Type @ to mention shots or characters • Ctrl+Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}