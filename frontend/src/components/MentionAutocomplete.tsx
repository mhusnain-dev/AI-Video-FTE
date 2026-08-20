import { useRef, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { HashtagIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { useStory } from '../hooks/useStories';
import { useCharacters } from '../hooks/useStories';
import { useChatStore } from '../store/chatStore';

interface MentionAutocompleteProps {
  show: boolean;
  query: string;
  onSelect: (mention: { type: 'shot' | 'character'; id: string; label: string }) => void;
  onClose: () => void;
}

export function MentionAutocomplete({ show, query, onSelect, onClose }: MentionAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { storyId } = useChatStore();

  const { data: story } = useStory(storyId || '');
  const shots = story?.shots || [];

  const { data: charsData } = useCharacters(storyId || '');
  const characters = charsData?.characters || [];

  const filteredShots = shots.filter((s: { visualDescription: string }) =>
    s.visualDescription.toLowerCase().includes(query.toLowerCase())
  );
  const filteredChars = characters.filter((c: { name: string }) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  const allItems = [
    ...filteredShots.map((s: { id: string; orderIndex: number; visualDescription: string }) => ({
      type: 'shot' as const,
      id: s.id,
      label: `Shot #${s.orderIndex + 1}: ${s.visualDescription.substring(0, 40)}`,
    })),
    ...filteredChars.map((c: { id: string; name: string }) => ({
      type: 'character' as const,
      id: c.id,
      label: c.name,
    })),
  ];

  useEffect(() => {
    if (show && listRef.current) {
      listRef.current.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [show, selectedIndex, filteredShots, filteredChars]);

  if (!show || allItems.length === 0) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems[selectedIndex]) onSelect(allItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 z-50" onKeyDown={handleKeyDown}>
      <ul
        ref={listRef}
        className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto w-80"
        role="listbox"
      >
        {allItems.length === 0 && (
          <li className="px-4 py-2 text-gray-500 text-sm">No matches</li>
        )}
        {allItems.map((item, idx) => (
          <li
            key={item.id}
            data-index={idx}
            className={clsx(
              'px-4 py-2 flex items-center gap-3 cursor-pointer',
              idx === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
            )}
            role="option"
            aria-selected={idx === selectedIndex}
            onClick={() => onSelect(item)}
          >
            {item.type === 'shot' ? (
              <HashtagIcon className="w-5 h-5 text-primary-600 flex-shrink-0" />
            ) : (
              <UserCircleIcon className="w-5 h-5 text-purple-600 flex-shrink-0" />
            )}
            <span className="text-sm text-gray-900 truncate">{item.label}</span>
            <span className="ml-auto px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {item.type === 'shot' ? 'Shot' : 'Character'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}