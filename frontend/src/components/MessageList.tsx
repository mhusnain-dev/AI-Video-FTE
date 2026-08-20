import { clsx } from 'clsx';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { ActionCard } from './ActionCard';
import type { ChatMessage } from '../store/chatStore';

interface MessageListProps {
  messages: ChatMessage[];
  streamBuffer: string;
  streaming: boolean;
  pendingAction: any;
  readOnly: boolean;
  onApplyAction: () => void;
  onDismissAction: () => void;
}

export function MessageList({
  messages,
  streamBuffer,
  streaming,
  pendingAction,
  readOnly,
  onApplyAction,
  onDismissAction,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p className="text-sm">Start a conversation with FTE</p>
        <p className="text-xs text-gray-400 mt-1">Ask about shots, characters, transitions, or anything else</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((msg, idx) => (
        <div
          key={msg.id}
          className={clsx(
            'flex gap-3',
            msg.role === 'user' ? 'justify-end' : 'justify-start'
          )}
        >
          {/* Avatar */}
          <div className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
            msg.role === 'user' ? 'bg-primary-100' : 'bg-purple-100'
          )}>
            {msg.role === 'user' ? (
              <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h18a7 7 0 00-7-7z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            )}
          </div>

          {/* Message bubble */}
          <div className={clsx(
            'max-w-[80%] px-4 py-2.5 rounded-2xl',
            msg.role === 'user'
              ? 'bg-primary-500 text-white rounded-tr-none'
              : 'bg-purple-50 text-gray-900 rounded-tl-none'
          )}>
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {msg.content}{streaming && idx === messages.length - 1 && streamBuffer}
              </pre>
            </div>

            {/* Actions for assistant messages */}
            {msg.role === 'assistant' && !readOnly && (
              <div className="flex items-center gap-1 mt-2">
                <button
                  onClick={() => navigator.clipboard.writeText(msg.content)}
                  className="btn-ghost p-1.5 text-xs"
                  title="Copy"
                >
                  <DocumentDuplicateIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Streaming indicator */}
      {streaming && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 text-sm text-gray-500 bg-purple-50 px-3 py-1.5 rounded-xl">
            <span className="flex gap-1">
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span>FTE is thinking...</span>
          </div>
        </div>
      )}

      {/* Pending Action Card */}
      {pendingAction && (
        <ActionCard
          action={pendingAction}
          onApply={onApplyAction}
          onDismiss={onDismissAction}
        />
      )}
    </div>
  );
}