import { clsx } from 'clsx';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '../store/chatStore';

interface ChatEntryButtonProps {
  storyId: string;
  readOnly?: boolean;
}

export function ChatEntryButton({ storyId, readOnly = false }: ChatEntryButtonProps) {
  const { open, isOpen, storyId: currentStoryId } = useChatStore();
  const isCurrentStory = currentStoryId === storyId;

  return (
    <button
      onClick={() => open(storyId, readOnly)}
      disabled={isOpen && isCurrentStory}
      className={clsx(
        'btn-ghost p-2.5 relative transition-all',
        isOpen && isCurrentStory ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:text-primary-600',
        readOnly && 'opacity-50 cursor-not-allowed'
      )}
      title={readOnly ? 'Read-only mode' : 'Chat with FTE (Ctrl+Shift+F)'}
      aria-label="Chat with FTE"
    >
      <div className="relative">
        <SparklesIcon className="w-5 h-5" />
        {isOpen && isCurrentStory && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full" />
        )}
      </div>
    </button>
  );
}

// Keyboard shortcut handler
if (typeof window !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      // Find the first ChatEntryButton on the page and click it
      const btn = document.querySelector('[title*="Chat with FTE"]') as HTMLButtonElement;
      if (btn && !btn.disabled) btn.click();
    }
  });
}